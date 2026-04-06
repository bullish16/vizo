const axios = require('axios');
const config = require('./config');

// Main VIZO API client
const vizoApi = axios.create({
  baseURL: config.API.BASE_URL,
  timeout: 35000,
  headers: { 'Content-Type': 'application/json' },
});

// Prediction API client
const predictionApi = axios.create({
  baseURL: config.API.PREDICTION_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

let jwtToken = null;

// Set auth token
function setToken(token) {
  jwtToken = token;
  vizoApi.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

function getToken() {
  return jwtToken;
}

// Request interceptor — attach token
vizoApi.interceptors.request.use((req) => {
  if (req.headers?.isToken === false) return req;
  if (jwtToken) req.headers['Authorization'] = `Bearer ${jwtToken}`;
  return req;
});

// Response interceptor — handle errors
vizoApi.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      console.error('[API] Token expired, need re-login');
    }
    return Promise.reject(err);
  }
);

// ==================== AUTH ====================

async function getLoginKey(addr) {
  return vizoApi.post(config.ENDPOINTS.LOGIN_KEY, { addr }, { headers: { isToken: false } });
}

async function doLogin(addr, key, sign, inviteCode = '') {
  const res = await vizoApi.post(
    config.ENDPOINTS.DO_LOGIN,
    { addr, key, sign, inviteCode },
    { headers: { isToken: false } }
  );
  if (res.data?.token) {
    setToken(res.data.token);
  }
  return res;
}

async function refreshToken() {
  const res = await vizoApi.post(config.ENDPOINTS.REFRESH_TOKEN);
  if (res.data?.token) {
    setToken(res.data.token);
  }
  return res;
}

// ==================== ACCOUNT ====================

async function getBalance() {
  return vizoApi({ method: 'GET', url: config.ENDPOINTS.GET_BALANCE });
}

async function getUserInfo() {
  return vizoApi({ method: 'POST', url: config.ENDPOINTS.USER_INFO });
}

async function getScore() {
  return vizoApi({ method: 'GET', url: config.ENDPOINTS.GET_SCORE });
}

// ==================== MARKETS ====================

async function listMarkets(page = 1, pageSize = 50, category = 'trending') {
  return vizoApi.post(config.ENDPOINTS.LIST_MARKETS, {
    filter: {
      status: ['OPEN'],
      page,
      page_size: pageSize,
      ...(category !== 'trending' && { market_categories: [category] }),
    },
  });
}

async function searchMarkets(query) {
  return vizoApi.post(config.ENDPOINTS.SEARCH_MARKETS, { keyword: query });
}

async function getMarketDetail(marketId) {
  return vizoApi({ method: 'GET', url: `${config.ENDPOINTS.MARKET_BASE}/${marketId}` });
}

async function getContractAddress() {
  return vizoApi({ method: 'GET', url: config.ENDPOINTS.CONTRACT_ADDRESS });
}

// ==================== ORDERS ====================

async function placeOrder({ symbol, side, type, price, quantity, outcome }) {
  return vizoApi.post(config.ENDPOINTS.PLACE_ORDER, {
    symbol,
    side,     // 1 = buy, 2 = sell
    type,     // 1 = limit, 2 = market
    price: price || '',
    quantity,
    outcome,  // "YES" or "NO"
  });
}

async function cancelOrder(orderId) {
  return vizoApi.post(config.ENDPOINTS.CANCEL_ORDER, { orderId });
}

async function getOrderbook(symbol, depth = 10, outcome = 'YES') {
  return vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.ORDERBOOK}?symbol=${symbol}&depth=${depth}&outcome=${outcome}`,
  });
}

async function getOrderList(symbol, page = 1, pageSize = 20, outcome = '') {
  return vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.ORDER_LIST}?symbol=${symbol}&status=0&status=1&page=${page}&pageSize=${pageSize}&outcome=${outcome}`,
  });
}

async function getHoldingOrders(page = 1, pageSize = 20) {
  return vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.HOLDING_ORDER}?page=${page}&pageSize=${pageSize}`,
  });
}

async function getTrades(symbol, page = 1, pageSize = 20) {
  return vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.TRADES}?symbol=${symbol}&page=${page}&pageSize=${pageSize}`,
  });
}

async function getTransactionHistory(page = 1, pageSize = 20) {
  return vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.TX_HISTORY}?page=${page}&pageSize=${pageSize}`,
  });
}

// ==================== MARKET DATA ====================

async function getExpectedMove(symbol) {
  try {
    const res = await axios.get(`${config.API.MARKET_DATA_URL}/${symbol}`, { timeout: 5000 });
    return res.data;
  } catch (err) {
    // 404 is normal — not all markets have expected move data
    if (err.response?.status !== 404) {
      console.error('[DATA] getExpectedMove error:', err.message);
    }
    return null;
  }
}

async function getHistory(symbol) {
  try {
    const res = await axios.get(`${config.API.HISTORY_URL}/${symbol}`, { timeout: 5000 });
    return res.data;
  } catch (err) {
    // 404 is normal — not all markets have history
    if (err.response?.status !== 404) {
      console.error('[DATA] getHistory error:', err.message);
    }
    return null;
  }
}

// ==================== PREDICTION ====================

async function getPrediction(data) {
  try {
    const res = await predictionApi.post('', data);
    if (res.data?.detail) return null; // API returned error detail
    return res.data;
  } catch (err) {
    // 400/404 is normal — not all markets supported
    if (err.response?.status !== 400 && err.response?.status !== 404) {
      console.error('[PREDICT] Error:', err.message);
    }
    return null;
  }
}

// ==================== BET SYSTEM ====================

async function marketBet({ market_id_hash, gradient_id, amount, side, address }) {
  const payload = {
    market_id_hash,
    gradient_id,
    amount,
    side,       // 1 = buy (YES direction), -1 = sell (NO direction)
    address,
  };
  console.log(`[API] marketBet payload:`, JSON.stringify(payload));
  const res = await vizoApi.post(config.ENDPOINTS.BET, payload);
  console.log(`[API] marketBet response:`, JSON.stringify(res).substring(0, 500));

  // Check for empty/null data which indicates the bet wasn't registered
  if (!res || !res.data) {
    console.warn(`[API] ⚠️ marketBet returned empty data! Response:`, JSON.stringify(res));
  }
  return res;
}

async function betExecuteEncode(type = 'execute') {
  const typeCode = type === 'approve' ? 0 : 1;
  console.log(`[API] betExecuteEncode type=${type} (code=${typeCode})`);
  const res = await vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.BET_EXECUTE_ENCODE}/${typeCode}`,
  });
  console.log(`[API] betExecuteEncode response:`, JSON.stringify(res).substring(0, 500));
  return res;
}

async function betExecute(data) {
  const typeCode = data.type === 'approve' ? 0 : 1;
  console.log(`[API] betExecute type=${data.type} (code=${typeCode})`);
  const res = await vizoApi.post(config.ENDPOINTS.BET_EXECUTE, {
    ...data,
    type: typeCode,
  });
  console.log(`[API] betExecute response:`, JSON.stringify(res).substring(0, 500));
  return res;
}

async function getBetStats(marketIdHash) {
  return vizoApi({
    method: 'GET',
    url: `${config.ENDPOINTS.BET_STATS}/${marketIdHash}`,
  });
}

async function getAddressInfo() {
  return vizoApi({ method: 'GET', url: config.ENDPOINTS.ADDRESS_INFO });
}

async function getActivityRank(page = 1, pageCount = 10) {
  return vizoApi.post(config.ENDPOINTS.ACTIVITY_RANK, { page, pageCount });
}

module.exports = {
  vizoApi,
  setToken,
  getToken,
  getLoginKey,
  doLogin,
  refreshToken,
  getBalance,
  getUserInfo,
  getScore,
  listMarkets,
  searchMarkets,
  getMarketDetail,
  getContractAddress,
  placeOrder,
  cancelOrder,
  getOrderbook,
  getOrderList,
  getHoldingOrders,
  getTrades,
  getTransactionHistory,
  getExpectedMove,
  getHistory,
  getPrediction,
  marketBet,
  betExecuteEncode,
  betExecute,
  getBetStats,
  getAddressInfo,
  getActivityRank,
};
