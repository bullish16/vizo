const config = require('./config');
const api = require('./api');
const wallet = require('./wallet');
const risk = require('./risk');
const { getStrategy } = require('./strategies');

class TradingBot {
  constructor() {
    this.isRunning = false;
    this.scanInterval = null;
    this.strategy = getStrategy(config.TRADING.STRATEGY);
    this.stats = {
      scans: 0,
      tradesPlaced: 0,
      tradesSkipped: 0,
      errors: 0,
      startedAt: null,
    };
  }

  async initialize() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   VIZO Tradathon Bot v1.0                ║');
    console.log('║   Base Sepolia • Prediction Market       ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`[BOT] Strategy: ${config.TRADING.STRATEGY}`);
    console.log(`[BOT] Max bet: ${config.TRADING.MAX_BET_USDC} USDC`);
    console.log(`[BOT] Min confidence: ${config.TRADING.MIN_CONFIDENCE * 100}%`);
    console.log(`[BOT] Dry run: ${config.TRADING.DRY_RUN}`);
    console.log('');

    // Initialize wallet
    wallet.initialize();

    // Check balances
    const ethBal = await wallet.getETHBalance();
    const usdcBal = await wallet.getUSDCBalance();
    console.log(`[WALLET] ETH: ${ethBal}`);
    console.log(`[WALLET] USDC: ${usdcBal}`);

    if (parseFloat(ethBal) === 0) {
      console.warn('[WALLET] ⚠️  No ETH for gas! Get some from Base Sepolia faucet');
    }

    // Login to VIZO
    await wallet.login();
    wallet.startTokenRefresh();

    // Get platform balance
    try {
      const platformBal = await api.getBalance();
      console.log('[PLATFORM] Balance:', JSON.stringify(platformBal.data || platformBal));
    } catch (err) {
      console.log('[PLATFORM] Could not fetch platform balance (might need deposit first)');
    }

    console.log('\n[BOT] ✅ Initialization complete!\n');
  }

  async start(intervalMs = 60000) {
    if (this.isRunning) {
      console.log('[BOT] Already running!');
      return;
    }

    this.isRunning = true;
    this.stats.startedAt = new Date();
    console.log(`[BOT] 🚀 Starting... scanning every ${intervalMs / 1000}s`);

    // Initial scan
    await this.scan();

    // Periodic scanning
    this.scanInterval = setInterval(() => this.scan(), intervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    console.log('[BOT] ⏹ Stopped');
    this.printStats();
  }

  async scan() {
    this.stats.scans++;
    console.log(`\n[SCAN #${this.stats.scans}] ${new Date().toISOString()}`);

    try {
      // 1. Fetch available markets (POST with filter)
      const marketsRes = await api.listMarkets(1, 50);
      const markets = marketsRes.data?.markets || marketsRes.markets || [];

      if (!Array.isArray(markets) || markets.length === 0) {
        console.log('[SCAN] No markets available');
        console.log('[SCAN] Raw response:', JSON.stringify(marketsRes).substring(0, 300));
        return;
      }

      console.log(`[SCAN] Found ${markets.length} markets`);

      // 2. Get current balance
      let balance = '0';
      try {
        const balRes = await api.getBalance();
        balance = balRes.data?.balance || balRes.balance || '0';
      } catch {
        balance = await wallet.getUSDCBalance();
      }
      console.log(`[SCAN] Available balance: ${balance} USDC`);

      // 3. Analyze each market
      for (const market of markets) {
        await this.analyzeMarket(market, balance);
      }
    } catch (err) {
      this.stats.errors++;
      console.error(`[SCAN] Error: ${err.message}`);
    }
  }

  async analyzeMarket(market, balance) {
    const symbol = market.token_symbol || market.market_id_hash || market.id;
    const title = market.description || market.token_symbol || symbol;

    try {
      // Run strategy
      const signal = await this.strategy(market);

      console.log(`  📊 ${title}`);
      console.log(`     Signal: ${signal.direction} (${(signal.confidence * 100).toFixed(1)}%) - ${signal.reason}`);

      // Risk evaluation
      const riskCheck = risk.evaluate(signal, balance);

      if (!riskCheck.approved) {
        console.log(`     ❌ Skip: ${riskCheck.reason}`);
        this.stats.tradesSkipped++;
        return;
      }

      console.log(`     ✅ ${riskCheck.reason}`);

      // Execute trade
      if (config.TRADING.DRY_RUN) {
        console.log(`     🧪 [DRY RUN] Would place: ${signal.direction} ${riskCheck.betSize} USDC`);
        this.stats.tradesSkipped++;
      } else {
        await this.executeTrade(market, signal, riskCheck);
      }
    } catch (err) {
      console.error(`  ⚠️  ${title}: ${err.message}`);
      this.stats.errors++;
    }
  }

  async executeTrade(market, signal, riskCheck) {
    const marketHash = market.market_id_hash;

    // Find the right gradient_id based on signal direction
    let gradientId = 1;
    if (market.gradients_json && market.gradients_json.length > 0) {
      if (market.is_yes_or_no) {
        gradientId = signal.direction === 'YES' ? 1 : 2;
      } else {
        if (signal.direction === 'YES' || signal.direction === 'UP') gradientId = 1;
        else if (signal.direction === 'NO' || signal.direction === 'DOWN') gradientId = 2;
        else gradientId = signal.gradientId || 1;
      }
    }

    const gradientMatch = market.gradients_json?.find(g => g.gradient_id === gradientId);
    const side = gradientMatch?.direction || 1;
    const walletAddr = wallet.address;

    console.log(`     🔥 Placing bet: ${signal.direction} (gradient ${gradientId}, side ${side}) ${riskCheck.betSize} USDC`);
    console.log(`     [DEBUG] market_id_hash: ${marketHash}, wallet: ${walletAddr}`);

    // ═══════ STEP 0: Ensure USDC is approved for the VIZO contract ═══════
    try {
      await this._ensureApproved(riskCheck.betSize);
    } catch (approveErr) {
      console.error(`     ❌ USDC approval failed: ${approveErr.message}`);
      this.stats.errors++;
      return;
    }

    // ═══════ METHOD 1: Bet API flow (bet → encode → execute on-chain) ═══════
    try {
      // Step 1: Register bet on backend
      console.log(`     [BET] Step 1: Registering bet...`);
      const betResult = await api.marketBet({
        market_id_hash: marketHash,
        gradient_id: gradientId,
        amount: String(riskCheck.betSize),
        side: side,
        address: walletAddr || '',
      });
      console.log(`     [BET] Response:`, JSON.stringify(betResult).substring(0, 300));

      if (betResult?.code !== undefined && betResult.code !== 0 && betResult.code !== 200) {
        throw new Error(`Backend rejected: ${betResult.msg || betResult.message || 'unknown'} (code: ${betResult.code})`);
      }

      // Step 2: Get execute encode data and send on-chain
      console.log(`     [BET] Step 2: Getting execute tx...`);
      const executeEncode = await api.betExecuteEncode('execute');
      console.log(`     [BET] Execute encode:`, JSON.stringify(executeEncode).substring(0, 300));

      const execData = executeEncode?.data || executeEncode;
      const execTo = execData?.to || execData?.contract_address || execData?.address;
      const execCalldata = execData?.data || execData?.calldata || execData?.encode;

      if (execTo && execCalldata) {
        console.log(`     [BET] Step 3: Sending execute tx to ${execTo}...`);
        const receipt = await wallet.sendTransaction({
          to: execTo,
          data: execCalldata,
          value: execData.value || '0x0',
        });
        const txHash = receipt.hash || receipt.transactionHash;
        console.log(`     [BET] ✅ Executed on-chain! Tx: ${txHash}`);

        // Notify backend
        try {
          await api.betExecute({ type: 'execute', tx_hash: txHash, market_id_hash: marketHash, gradient_id: gradientId });
          console.log(`     [BET] ✅ Backend notified`);
        } catch (_) { /* best effort */ }
      } else {
        // No on-chain tx needed — call betExecute directly (server-side execution)
        console.log(`     [BET] No encoded tx, calling betExecute directly...`);
        const execResult = await api.betExecute({
          type: 'execute',
          market_id_hash: marketHash,
          gradient_id: gradientId,
          amount: String(riskCheck.betSize),
          address: walletAddr,
        });
        console.log(`     [BET] ✅ Result:`, JSON.stringify(execResult).substring(0, 300));
      }

      risk.addPosition({ symbol: market.token_symbol, marketHash, gradientId, direction: signal.direction, size: riskCheck.betSize, confidence: signal.confidence });
      this.stats.tradesPlaced++;

    } catch (betErr) {
      console.log(`     ⚠️  Bet flow failed (${betErr.message}), trying CLOB fallback...`);

      // ═══════ METHOD 2: CLOB Order Fallback ═══════
      try {
        const orderSymbol = `${marketHash}_${gradientId}`;
        const result = await api.placeOrder({
          symbol: orderSymbol,
          side: 1,
          type: 2,
          price: '',
          quantity: String(riskCheck.betSize),
          outcome: signal.direction === 'YES' || signal.direction === 'UP' ? 'YES' : 'NO',
        });
        console.log(`     ✅ CLOB Order placed!`, JSON.stringify(result).substring(0, 200));

        risk.addPosition({ symbol: market.token_symbol, marketHash, gradientId, direction: signal.direction, size: riskCheck.betSize, confidence: signal.confidence });
        this.stats.tradesPlaced++;
      } catch (orderErr) {
        console.error(`     ❌ All methods failed: ${orderErr.message}`);
        this.stats.errors++;
      }
    }
  }

  // ── Approve USDC for VIZO contract (cached, only runs once) ──
  async _ensureApproved(amount) {
    if (this._approved) return;

    const { ethers } = require('ethers');
    const neededAmount = ethers.parseUnits(String(Math.ceil(amount)), 6);

    // Strategy 1: Get contract address from VIZO API
    let vizoContract = null;
    try {
      const contractInfo = await api.getContractAddress();
      vizoContract = contractInfo?.data?.address || contractInfo?.data?.contractAddress
                   || contractInfo?.address || contractInfo?.contractAddress;
      if (vizoContract) console.log(`     [APPROVE] VIZO contract: ${vizoContract}`);
    } catch (err) {
      console.log(`     [APPROVE] getContractAddress failed: ${err.message}`);
    }

    // Strategy 2: Extract spender from betExecuteEncode approve response
    if (!vizoContract) {
      try {
        const encRes = await api.betExecuteEncode('approve');
        const encData = encRes?.data || encRes;
        // The approve tx targets the USDC contract, but the encoded calldata has the spender
        // Try to decode: approve(address,uint256) = 0x095ea7b3 + 32-byte address + 32-byte amount
        const calldata = encData?.data || encData?.calldata || encData?.encode;
        if (calldata && calldata.length >= 74) {
          const spenderHex = '0x' + calldata.slice(34, 74);
          if (ethers.isAddress(spenderHex)) {
            vizoContract = ethers.getAddress(spenderHex);
            console.log(`     [APPROVE] Decoded spender from calldata: ${vizoContract}`);
          }
        }
        // Also try 'to' field from encode response as the USDC target (not the spender)
        // The 'to' here is the USDC contract — not what we need for allowance check
      } catch (err) {
        console.log(`     [APPROVE] betExecuteEncode failed: ${err.message}`);
      }
    }

    if (!vizoContract) {
      throw new Error('Could not determine VIZO contract address for USDC approval');
    }

    // Check existing allowance
    const currentAllowance = await wallet.getUSDCAllowance(vizoContract);
    if (currentAllowance >= neededAmount) {
      console.log(`     [APPROVE] ✅ Already approved (allowance: ${ethers.formatUnits(currentAllowance, 6)} USDC)`);
      this._approved = true;
      return;
    }

    // Do the approve
    await wallet.approveUSDC(vizoContract);
    this._approved = true;
  }

  printStats() {
    const runtime = this.stats.startedAt
      ? Math.round((Date.now() - this.stats.startedAt.getTime()) / 1000 / 60)
      : 0;

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   📈 Bot Statistics                      ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Runtime:        ${runtime} minutes`);
    console.log(`║  Scans:          ${this.stats.scans}`);
    console.log(`║  Trades placed:  ${this.stats.tradesPlaced}`);
    console.log(`║  Trades skipped: ${this.stats.tradesSkipped}`);
    console.log(`║  Errors:         ${this.stats.errors}`);
    console.log('║');
    console.log('║  Risk Status:');
    const riskStatus = risk.getStatus();
    console.log(`║    Daily PnL:    ${riskStatus.dailyPnL} USDC`);
    console.log(`║    Positions:    ${riskStatus.openPositions}/${riskStatus.maxOpenPositions}`);
    console.log('╚══════════════════════════════════════════╝');
  }

  // One-shot analysis without trading
  async analyze() {
    console.log('[BOT] Running analysis-only mode...\n');
    await this.scan();
    this.printStats();
  }
}

module.exports = TradingBot;
