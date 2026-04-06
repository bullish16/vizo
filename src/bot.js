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
        // YES/NO market: YES = gradient 1, NO = gradient 2
        gradientId = signal.direction === 'YES' ? 1 : 2;
      } else {
        // Multi-option: find best matching gradient
        const labels = market.gradients_json.map(g => g.label.toUpperCase());
        if (signal.direction === 'YES' || signal.direction === 'UP') gradientId = 1;
        else if (signal.direction === 'NO' || signal.direction === 'DOWN') gradientId = 2;
        else gradientId = signal.gradientId || 1;
      }
    }

    const side = market.gradients_json?.find(g => g.gradient_id === gradientId)?.direction || 1;

    console.log(`     🔥 Placing bet: ${signal.direction} (gradient ${gradientId}) ${riskCheck.betSize} USDC`);

    // ========== METHOD 1: Direct Bet API (approve → bet → encode → execute) ==========
    try {
      const walletAddr = wallet.address;

      // Step 1: Call marketBet to register the bet on the backend
      console.log(`     [BET] Step 1/4: Registering bet on backend...`);
      const betResult = await api.marketBet({
        market_id_hash: marketHash,
        gradient_id: gradientId,
        amount: String(riskCheck.betSize),
        side: side,
        address: walletAddr || '',
      });
      console.log(`     [BET] Bet registered:`, JSON.stringify(betResult).substring(0, 300));

      // Step 2: Get the approve encode data (type=0 for approve)
      console.log(`     [BET] Step 2/4: Getting approve tx data...`);
      const approveEncode = await api.betExecuteEncode('approve');
      console.log(`     [BET] Approve encode:`, JSON.stringify(approveEncode).substring(0, 300));

      // Step 3: If approve data is returned, send the approve transaction on-chain
      if (approveEncode?.data) {
        const approveData = approveEncode.data;
        const approveTo = approveData.to || approveData.contract_address || approveData.address;
        const approveCalldata = approveData.data || approveData.calldata || approveData.encode;

        if (approveTo && approveCalldata) {
          // Check if we already have sufficient allowance
          const currentAllowance = await wallet.getUSDCAllowance(approveTo);
          const neededAmount = BigInt(Math.ceil(riskCheck.betSize * 1e6));

          if (currentAllowance < neededAmount) {
            console.log(`     [BET] Sending approve tx to ${approveTo}...`);
            const approveTx = await wallet.sendTransaction({
              to: approveTo,
              data: approveCalldata,
              value: approveData.value || '0x0',
            });
            console.log(`     [BET] ✅ Approve confirmed!`);
          } else {
            console.log(`     [BET] ✅ Already approved (allowance sufficient)`);
          }
        } else {
          // Fallback: approve USDC for the contract directly
          console.log(`     [BET] No encoded approve data, trying direct USDC approve...`);
          try {
            const contractInfo = await api.getContractAddress();
            const contractAddr = contractInfo?.data?.address || contractInfo?.address;
            if (contractAddr) {
              await wallet.approveUSDC(contractAddr);
            }
          } catch (approveErr) {
            console.log(`     [BET] Direct approve skipped: ${approveErr.message}`);
          }
        }
      }

      // Step 4: Get the execute encode data (type=1 for execute) and send it
      console.log(`     [BET] Step 3/4: Getting execute tx data...`);
      const executeEncode = await api.betExecuteEncode('execute');
      console.log(`     [BET] Execute encode:`, JSON.stringify(executeEncode).substring(0, 300));

      if (executeEncode?.data) {
        const execData = executeEncode.data;
        const execTo = execData.to || execData.contract_address || execData.address;
        const execCalldata = execData.data || execData.calldata || execData.encode;

        if (execTo && execCalldata) {
          console.log(`     [BET] Step 4/4: Sending execute tx to ${execTo}...`);
          const execReceipt = await wallet.sendTransaction({
            to: execTo,
            data: execCalldata,
            value: execData.value || '0x0',
          });
          console.log(`     [BET] ✅ Execute confirmed! Tx: ${execReceipt.hash || execReceipt.transactionHash}`);

          // Report execution back to backend
          try {
            await api.betExecute({
              type: 'execute',
              tx_hash: execReceipt.hash || execReceipt.transactionHash,
              market_id_hash: marketHash,
              gradient_id: gradientId,
            });
            console.log(`     [BET] ✅ Backend notified of execution`);
          } catch (reportErr) {
            console.log(`     [BET] Backend report: ${reportErr.message} (bet still on-chain)`);
          }
        } else {
          // No encoded tx data — try betExecute directly (some APIs handle it server-side)
          console.log(`     [BET] No encoded execute data, calling betExecute directly...`);
          const execResult = await api.betExecute({
            type: 'execute',
            market_id_hash: marketHash,
            gradient_id: gradientId,
            amount: String(riskCheck.betSize),
            address: walletAddr,
          });
          console.log(`     [BET] ✅ betExecute result:`, JSON.stringify(execResult).substring(0, 300));
        }
      } else {
        // No encode data returned — the bet API might handle everything server-side
        console.log(`     [BET] No execute encode data returned, trying betExecute directly...`);
        const execResult = await api.betExecute({
          type: 'execute',
          market_id_hash: marketHash,
          gradient_id: gradientId,
          amount: String(riskCheck.betSize),
          address: walletAddr,
        });
        console.log(`     [BET] ✅ betExecute result:`, JSON.stringify(execResult).substring(0, 300));
      }

      // Track position
      risk.addPosition({
        symbol: market.token_symbol,
        marketHash,
        gradientId,
        direction: signal.direction,
        size: riskCheck.betSize,
        confidence: signal.confidence,
      });

      this.stats.tradesPlaced++;
    } catch (betErr) {
      console.log(`     ⚠️  Bet flow failed (${betErr.message}), trying CLOB order fallback...`);

      // ========== METHOD 2: CLOB Order Fallback ==========
      try {
        const orderSymbol = `${marketHash}_${gradientId}`;
        const result = await api.placeOrder({
          symbol: orderSymbol,
          side: 1,            // 1 = buy
          type: 2,            // 2 = market order
          price: '',
          quantity: String(riskCheck.betSize),
          outcome: signal.direction === 'YES' || signal.direction === 'UP' ? 'YES' : 'NO',
        });

        console.log(`     ✅ CLOB Order placed! Result:`, JSON.stringify(result).substring(0, 200));

        risk.addPosition({
          symbol: market.token_symbol,
          marketHash,
          gradientId,
          direction: signal.direction,
          size: riskCheck.betSize,
          confidence: signal.confidence,
        });

        this.stats.tradesPlaced++;
      } catch (orderErr) {
        console.error(`     ❌ All methods failed: ${orderErr.message}`);
        this.stats.errors++;
      }
    }
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
