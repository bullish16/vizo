const { ethers } = require('ethers');
const config = require('./config');
const api = require('./api');

class WalletManager {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.address = null;
  }

  initialize() {
    if (!config.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not set in .env');
    }
    this.provider = new ethers.JsonRpcProvider(config.RPC_URL, config.CHAIN_ID);
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);
    this.address = this.wallet.address;
    console.log(`[WALLET] Initialized: ${this.address}`);
    return this;
  }

  async signMessage(message) {
    return this.wallet.signMessage(message);
  }

  async getETHBalance() {
    const balance = await this.provider.getBalance(this.address);
    return ethers.formatEther(balance);
  }

  async getUSDCBalance() {
    const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
    const usdc = new ethers.Contract(config.TOKENS.USDC, erc20Abi, this.provider);
    const balance = await usdc.balanceOf(this.address);
    return ethers.formatUnits(balance, 6);
  }

  // Login to VIZO platform
  async login() {
    console.log('[AUTH] Logging in...');

    // Step 1: Get login key
    const keyRes = await api.getLoginKey(this.address);
    const loginKey = keyRes.data?.key || keyRes.key;
    if (!loginKey) {
      throw new Error('Failed to get login key: ' + JSON.stringify(keyRes));
    }
    console.log('[AUTH] Got login key');

    // Step 2: Sign the key
    const signature = await this.signMessage(loginKey);
    console.log('[AUTH] Signed message');

    // Step 3: Login with signature
    const loginRes = await api.doLogin(this.address, loginKey, signature);
    console.log('[AUTH] Login successful!');

    return loginRes;
  }

  // Auto-refresh token periodically
  startTokenRefresh(intervalMs = 10 * 60 * 1000) {
    setInterval(async () => {
      try {
        await api.refreshToken();
        console.log('[AUTH] Token refreshed');
      } catch (err) {
        console.error('[AUTH] Token refresh failed, re-logging in...');
        await this.login();
      }
    }, intervalMs);
  }
}

module.exports = new WalletManager();
