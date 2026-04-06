const { RSI, MACD, BollingerBands, SMA, EMA } = require('technicalindicators');
const api = require('./api');
const config = require('./config');

// ==================== STRATEGY: Expected Move ====================
// Uses VIZO's built-in prediction API + technical analysis

async function expectedMoveStrategy(market) {
  const symbol = market.token_symbol || market.market_id_hash;
  const signals = [];

  // 0. Use on-chain probability from market gradients (most reliable!)
  if (market.gradients_json?.length > 0) {
    const yesGradient = market.gradients_json.find(g => 
      g.label === 'Yes' || g.label === 'UP' || g.gradient_id === 1
    );
    const noGradient = market.gradients_json.find(g => 
      g.label === 'No' || g.label === 'DOWN' || g.gradient_id === 2
    );

    if (yesGradient && noGradient) {
      const yesProb = yesGradient.probability || 0.5;
      const noProb = noGradient.probability || 0.5;

      signals.push({
        source: 'market_probability',
        direction: yesProb > noProb ? 'YES' : 'NO',
        confidence: Math.max(yesProb, noProb),
        data: { yesProb, noProb, betCount: market.bet_count },
      });
    }
  }

  // 1. Get expected move prediction from VIZO API
  const emData = await api.getExpectedMove(symbol);
  if (emData && !emData.error) {
    signals.push({
      source: 'expected_move',
      direction: emData.direction || (emData.expected_move > 0 ? 'YES' : 'NO'),
      confidence: Math.abs(emData.confidence || emData.probability || 0.5),
      data: emData,
    });
  }

  // 2. Get prediction from prediction API
  try {
    const prediction = await api.getPrediction({ symbol, market_id: market.market_id_hash });
    if (prediction && !prediction.error) {
      signals.push({
        source: 'prediction_api',
        direction: prediction.prediction === 'up' || prediction.probability > 0.5 ? 'YES' : 'NO',
        confidence: Math.abs(prediction.probability || prediction.confidence || 0.5),
        data: prediction,
      });
    }
  } catch (e) { /* prediction API might not have data for all markets */ }

  // 3. Get historical data for technical analysis
  try {
    const history = await api.getHistory(symbol);
    if (history?.prices?.length >= 14) {
      const taSignals = runTechnicalAnalysis(history.prices);
      signals.push(...taSignals);
    }
  } catch (e) { /* no history for some markets */ }

  return aggregateSignals(signals);
}

// ==================== STRATEGY: Orderbook Imbalance ====================
// Analyze orderbook depth to detect buying/selling pressure

async function orderbookStrategy(market) {
  const symbol = market.symbol || market.market_id_hash;
  const signals = [];

  try {
    // Get orderbook for both YES and NO
    const [yesBook, noBook] = await Promise.all([
      api.getOrderbook(symbol, 20, 'YES'),
      api.getOrderbook(symbol, 20, 'NO'),
    ]);

    const yesData = yesBook.data || yesBook;
    const noData = noBook.data || noBook;

    // Calculate buy vs sell volume imbalance
    if (yesData.bids && yesData.asks) {
      const bidVol = yesData.bids.reduce((sum, b) => sum + parseFloat(b.quantity || b[1] || 0), 0);
      const askVol = yesData.asks.reduce((sum, a) => sum + parseFloat(a.quantity || a[1] || 0), 0);
      const imbalance = bidVol / (bidVol + askVol || 1);

      signals.push({
        source: 'orderbook_yes',
        direction: imbalance > 0.55 ? 'YES' : imbalance < 0.45 ? 'NO' : 'NEUTRAL',
        confidence: Math.abs(imbalance - 0.5) * 2,
        data: { bidVol, askVol, imbalance },
      });
    }

    // Spread analysis
    if (yesData.bids?.[0] && yesData.asks?.[0]) {
      const bestBid = parseFloat(yesData.bids[0].price || yesData.bids[0][0]);
      const bestAsk = parseFloat(yesData.asks[0].price || yesData.asks[0][0]);
      const spread = bestAsk - bestBid;
      const midPrice = (bestBid + bestAsk) / 2;

      signals.push({
        source: 'spread_analysis',
        direction: midPrice > 0.5 ? 'YES' : 'NO',
        confidence: 1 - spread, // Tighter spread = more confidence
        data: { bestBid, bestAsk, spread, midPrice },
      });
    }
  } catch (err) {
    console.error('[STRATEGY] Orderbook error:', err.message);
  }

  return aggregateSignals(signals);
}

// ==================== STRATEGY: Momentum ====================
// Price momentum & trend following

async function momentumStrategy(market) {
  const symbol = market.symbol || market.market_id_hash;
  const signals = [];

  const history = await api.getHistory(symbol);
  if (!history?.prices || history.prices.length < 20) {
    return { direction: 'NEUTRAL', confidence: 0, reason: 'Insufficient data' };
  }

  const prices = history.prices.map((p) => parseFloat(p.price || p));

  // Price momentum (short-term vs long-term)
  const shortMA = SMA.calculate({ period: 5, values: prices });
  const longMA = SMA.calculate({ period: 15, values: prices });

  if (shortMA.length > 0 && longMA.length > 0) {
    const shortLast = shortMA[shortMA.length - 1];
    const longLast = longMA[longMA.length - 1];
    const crossover = shortLast > longLast;

    signals.push({
      source: 'ma_crossover',
      direction: crossover ? 'YES' : 'NO',
      confidence: Math.min(Math.abs(shortLast - longLast) / longLast * 10, 0.9),
      data: { shortMA: shortLast, longMA: longLast },
    });
  }

  // Rate of change
  if (prices.length >= 5) {
    const roc = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
    signals.push({
      source: 'rate_of_change',
      direction: roc > 0 ? 'YES' : 'NO',
      confidence: Math.min(Math.abs(roc) * 5, 0.85),
      data: { roc },
    });
  }

  const taSignals = runTechnicalAnalysis(prices);
  signals.push(...taSignals);

  return aggregateSignals(signals);
}

// ==================== TECHNICAL ANALYSIS ====================

function runTechnicalAnalysis(prices) {
  const signals = [];
  const priceValues = prices.map((p) => parseFloat(p.price || p));

  // RSI
  if (priceValues.length >= 14) {
    const rsi = RSI.calculate({ values: priceValues, period: 14 });
    const lastRSI = rsi[rsi.length - 1];
    if (lastRSI !== undefined) {
      let direction = 'NEUTRAL';
      let confidence = 0.5;
      if (lastRSI < 30) { direction = 'YES'; confidence = 0.7 + (30 - lastRSI) / 100; }
      else if (lastRSI > 70) { direction = 'NO'; confidence = 0.7 + (lastRSI - 70) / 100; }
      else if (lastRSI < 45) { direction = 'YES'; confidence = 0.55; }
      else if (lastRSI > 55) { direction = 'NO'; confidence = 0.55; }

      signals.push({ source: 'rsi', direction, confidence: Math.min(confidence, 0.95), data: { rsi: lastRSI } });
    }
  }

  // MACD
  if (priceValues.length >= 26) {
    const macd = MACD.calculate({
      values: priceValues,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const lastMACD = macd[macd.length - 1];
    if (lastMACD?.histogram !== undefined) {
      signals.push({
        source: 'macd',
        direction: lastMACD.histogram > 0 ? 'YES' : 'NO',
        confidence: Math.min(0.5 + Math.abs(lastMACD.histogram) * 2, 0.85),
        data: { histogram: lastMACD.histogram, signal: lastMACD.signal, macd: lastMACD.MACD },
      });
    }
  }

  // Bollinger Bands
  if (priceValues.length >= 20) {
    const bb = BollingerBands.calculate({ period: 20, values: priceValues, stdDev: 2 });
    const lastBB = bb[bb.length - 1];
    const lastPrice = priceValues[priceValues.length - 1];
    if (lastBB) {
      let direction = 'NEUTRAL';
      let confidence = 0.5;
      if (lastPrice <= lastBB.lower) { direction = 'YES'; confidence = 0.75; }
      else if (lastPrice >= lastBB.upper) { direction = 'NO'; confidence = 0.75; }

      signals.push({
        source: 'bollinger',
        direction,
        confidence,
        data: { price: lastPrice, upper: lastBB.upper, middle: lastBB.middle, lower: lastBB.lower },
      });
    }
  }

  return signals;
}

// ==================== SIGNAL AGGREGATION ====================

function aggregateSignals(signals) {
  if (signals.length === 0) {
    return { direction: 'NEUTRAL', confidence: 0, signals: [], reason: 'No signals available' };
  }

  // Filter out neutral signals
  const activeSignals = signals.filter((s) => s.direction !== 'NEUTRAL');
  if (activeSignals.length === 0) {
    return { direction: 'NEUTRAL', confidence: 0, signals, reason: 'All signals neutral' };
  }

  // Weighted voting
  const weights = {
    market_probability: 3.5,
    expected_move: 3,
    prediction_api: 2.5,
    orderbook_yes: 2,
    spread_analysis: 1.5,
    ma_crossover: 1.5,
    rate_of_change: 1,
    rsi: 1.5,
    macd: 1.5,
    bollinger: 1,
  };

  let yesScore = 0;
  let noScore = 0;

  for (const signal of activeSignals) {
    const weight = weights[signal.source] || 1;
    const score = signal.confidence * weight;
    if (signal.direction === 'YES') yesScore += score;
    else if (signal.direction === 'NO') noScore += score;
  }

  const totalScore = yesScore + noScore;
  const direction = yesScore > noScore ? 'YES' : 'NO';
  const confidence = Math.max(yesScore, noScore) / (totalScore || 1);

  return {
    direction,
    confidence: Math.round(confidence * 100) / 100,
    yesScore: Math.round(yesScore * 100) / 100,
    noScore: Math.round(noScore * 100) / 100,
    signals: activeSignals,
    reason: `${activeSignals.length} signals → ${direction} (${Math.round(confidence * 100)}%)`,
  };
}

// ==================== STRATEGY SELECTOR ====================

function getStrategy(name) {
  const strategies = {
    expected_move: expectedMoveStrategy,
    orderbook: orderbookStrategy,
    momentum: momentumStrategy,
    combined: combinedStrategy,
  };
  return strategies[name] || strategies.expected_move;
}

// Combined: run all strategies and merge
async function combinedStrategy(market) {
  const [em, ob, mom] = await Promise.all([
    expectedMoveStrategy(market),
    orderbookStrategy(market),
    momentumStrategy(market),
  ]);

  const allSignals = [...(em.signals || []), ...(ob.signals || []), ...(mom.signals || [])];
  return aggregateSignals(allSignals);
}

module.exports = {
  getStrategy,
  expectedMoveStrategy,
  orderbookStrategy,
  momentumStrategy,
  combinedStrategy,
  runTechnicalAnalysis,
  aggregateSignals,
};
