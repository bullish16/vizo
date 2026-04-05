const config = require('./config');

class RiskManager {
  constructor() {
    this.maxBetUSDC = config.TRADING.MAX_BET_USDC;
    this.minConfidence = config.TRADING.MIN_CONFIDENCE;
    this.maxDailyLoss = this.maxBetUSDC * 5;      // Max 5x single bet loss per day
    this.maxOpenPositions = 10;
    this.maxSingleMarketExposure = this.maxBetUSDC * 3;

    // State
    this.dailyPnL = 0;
    this.openPositions = [];
    this.tradeHistory = [];
    this.dailyResetTime = null;
  }

  // Reset daily counters
  resetDaily() {
    this.dailyPnL = 0;
    this.dailyResetTime = new Date();
    console.log('[RISK] Daily counters reset');
  }

  // Check if we should auto-reset
  checkDailyReset() {
    if (!this.dailyResetTime) {
      this.resetDaily();
      return;
    }
    const now = new Date();
    if (now.getUTCDate() !== this.dailyResetTime.getUTCDate()) {
      this.resetDaily();
    }
  }

  // Evaluate whether a trade passes risk checks
  evaluate(signal, balance) {
    this.checkDailyReset();

    const checks = [];

    // 1. Confidence threshold
    if (signal.confidence < this.minConfidence) {
      checks.push({
        pass: false,
        rule: 'min_confidence',
        reason: `Confidence ${(signal.confidence * 100).toFixed(1)}% < minimum ${(this.minConfidence * 100).toFixed(1)}%`,
      });
    } else {
      checks.push({ pass: true, rule: 'min_confidence' });
    }

    // 2. Daily loss limit
    if (this.dailyPnL <= -this.maxDailyLoss) {
      checks.push({
        pass: false,
        rule: 'daily_loss_limit',
        reason: `Daily loss ${this.dailyPnL.toFixed(2)} USDC exceeds limit -${this.maxDailyLoss} USDC`,
      });
    } else {
      checks.push({ pass: true, rule: 'daily_loss_limit' });
    }

    // 3. Max open positions
    if (this.openPositions.length >= this.maxOpenPositions) {
      checks.push({
        pass: false,
        rule: 'max_positions',
        reason: `${this.openPositions.length} open positions >= limit ${this.maxOpenPositions}`,
      });
    } else {
      checks.push({ pass: true, rule: 'max_positions' });
    }

    // 4. Balance check
    const betSize = this.calculateBetSize(signal, balance);
    if (betSize > parseFloat(balance)) {
      checks.push({
        pass: false,
        rule: 'insufficient_balance',
        reason: `Bet ${betSize} USDC > balance ${balance} USDC`,
      });
    } else {
      checks.push({ pass: true, rule: 'insufficient_balance' });
    }

    // 5. Direction must be clear
    if (signal.direction === 'NEUTRAL') {
      checks.push({
        pass: false,
        rule: 'neutral_signal',
        reason: 'Signal direction is NEUTRAL',
      });
    } else {
      checks.push({ pass: true, rule: 'neutral_signal' });
    }

    const passed = checks.every((c) => c.pass);
    const failedChecks = checks.filter((c) => !c.pass);

    return {
      approved: passed,
      betSize: passed ? this.calculateBetSize(signal, balance) : 0,
      checks,
      failedChecks,
      reason: passed
        ? `Approved: ${betSize.toFixed(2)} USDC on ${signal.direction}`
        : `Rejected: ${failedChecks.map((c) => c.reason).join('; ')}`,
    };
  }

  // Calculate optimal bet size using modified Kelly Criterion
  calculateBetSize(signal, balance) {
    const bal = parseFloat(balance);
    const p = signal.confidence;
    const b = 1; // Even odds (prediction market ~1:1)

    // Kelly: f = (bp - q) / b  where q = 1 - p
    const kelly = (b * p - (1 - p)) / b;
    const halfKelly = kelly / 2; // Conservative: half Kelly

    // Clamp between 0 and max bet
    const betFraction = Math.max(0, Math.min(halfKelly, 0.25)); // Never bet more than 25% of balance
    const betAmount = Math.min(betFraction * bal, this.maxBetUSDC);

    return Math.round(betAmount * 100) / 100;
  }

  // Track a new position
  addPosition(position) {
    this.openPositions.push({
      ...position,
      openedAt: new Date(),
    });
  }

  // Close a position and update PnL
  closePosition(symbol, pnl) {
    this.openPositions = this.openPositions.filter((p) => p.symbol !== symbol);
    this.dailyPnL += pnl;
    this.tradeHistory.push({
      symbol,
      pnl,
      closedAt: new Date(),
    });
  }

  // Get risk status summary
  getStatus() {
    return {
      dailyPnL: this.dailyPnL.toFixed(2),
      openPositions: this.openPositions.length,
      maxOpenPositions: this.maxOpenPositions,
      dailyLossLimit: this.maxDailyLoss,
      maxBet: this.maxBetUSDC,
      minConfidence: this.minConfidence,
      tradesThisSession: this.tradeHistory.length,
    };
  }
}

module.exports = new RiskManager();
