require('dotenv').config();

module.exports = {
  // Wallet
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: process.env.RPC_URL || 'https://sepolia.base.org',
  CHAIN_ID: 84532,

  // VIZO API endpoints
  API: {
    BASE_URL: 'https://poly-event.vizo.exchange',
    PREDICTION_URL: 'https://expected-move-api.onrender.com/predict',
    MARKET_DATA_URL: 'https://akedoapi-dev.akedo.fun/em-api/api/data',
    HISTORY_URL: 'https://akedoapi-dev.akedo.fun/em-api/api/history',
  },

  // Endpoints
  ENDPOINTS: {
    LOGIN_KEY: '/polyStock/login/loginKey',
    DO_LOGIN: '/polyStock/login/doLogin',
    CREATE_ACCOUNT: '/polyStock/login/createAccount',
    GET_BALANCE: '/polyStock/login/getBalance',
    USER_INFO: '/polyStock/login/userInfo',
    REFRESH_TOKEN: '/polyStock/login/refreshToken',
    LIST_MARKETS: '/polyStock/market/listMarkets',
    SEARCH_MARKETS: '/polyStock/market/searchMarkets',
    MARKET_BASE: '/polyStock/market',
    CONTRACT_ADDRESS: '/polyStock/market/contractAddress',
    // Bet endpoints
    BET: '/polyStock/bet/bet',
    BET_EXECUTE_ENCODE: '/polyStock/bet/executeEncode',
    BET_EXECUTE: '/polyStock/bet/execute',
    BET_HISTORY: '/polyStock/bet/history',
    LAST_BET: '/polyStock/bet/lastetBetOrders',
    BET_STATS: '/polyStock/bet/gradientBetStats',
    ACTIVITY_RANK: '/polyStock/bet/getActivityRank',
    // Account
    ADDRESS_INFO: '/polyStock/login/addressInfo',
    PLACE_ORDER: '/polyStock/order/place',
    CANCEL_ORDER: '/polyStock/order/cancel',
    ORDERBOOK: '/polyStock/order/orderbook',
    ORDER_LIST: '/polyStock/order/list',
    HOLDING_ORDER: '/polyStock/order/holdingOrder',
    TRADES: '/polyStock/order/trades',
    TX_HISTORY: '/polyStock/order/transactionHistory',
    GET_SCORE: '/polyStock/score/getScore',
    SCORE_INFO: '/polyStock/score/scoreInfo',
  },

  // Token addresses (Base Sepolia)
  TOKENS: {
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },

  // Trading parameters
  TRADING: {
    MAX_BET_USDC: parseFloat(process.env.MAX_BET_USDC) || 2000,
    MIN_BET_USDC: parseFloat(process.env.MIN_BET_USDC) || 500,
    MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE) || 0.65,
    STRATEGY: process.env.STRATEGY || 'expected_move',
    DRY_RUN: process.env.DRY_RUN !== 'false',
  },
};
