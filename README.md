# 🤖 VIZO Tradathon Trading Bot

Bot otomatis untuk prediction market di [VIZO Tradathon](https://tradathon.vizo.exchange) menggunakan blockchain **Base Sepolia**.

## ✨ Fitur

- **4 Strategi Trading:**
  - `expected_move` — Pakai prediction API VIZO + technical analysis
  - `orderbook` — Analisis kedalaman orderbook & imbalance
  - `momentum` — Trend following dengan MA crossover
  - `combined` — Gabungan semua strategi (paling akurat)

- **Technical Analysis:**
  - RSI (Relative Strength Index)
  - MACD (Moving Average Convergence Divergence)
  - Bollinger Bands
  - SMA/EMA crossover
  - Rate of Change

- **Risk Management:**
  - Kelly Criterion (half-Kelly) untuk position sizing
  - Daily loss limit
  - Max open positions
  - Minimum confidence threshold
  - Balance check

- **Keamanan:**
  - Private key disimpan di `.env` (tidak di-commit)
  - Dry run mode (default ON)
  - Auto token refresh

## 🚀 Setup

### 1. Siapkan Wallet Base Sepolia

- Buat wallet baru (atau pakai yang ada)
- Dapatkan ETH testnet dari [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)
- Dapatkan USDC testnet

### 2. Konfigurasi

```bash
cp .env.example .env
# Edit .env dan masukkan PRIVATE_KEY kamu
```

### 3. Install & Jalankan

```bash
npm install

# Analisis saja (tanpa trading)
node index.js analyze

# Mulai bot (dry run)
node index.js start

# Mulai bot (live trading)
# Edit .env: DRY_RUN=false
node index.js start
```

## 📋 Perintah

| Command | Deskripsi |
|---------|-----------|
| `node index.js analyze` | Analisis market sekali tanpa trading |
| `node index.js start` | Mulai bot dengan interval 60 detik |
| `node index.js start 30000` | Mulai bot dengan interval 30 detik |
| `node index.js help` | Tampilkan bantuan |

## ⚙️ Konfigurasi (.env)

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `PRIVATE_KEY` | - | Private key wallet kamu |
| `RPC_URL` | `https://sepolia.base.org` | Base Sepolia RPC |
| `MAX_BET_USDC` | `10` | Maksimum taruhan per trade |
| `MIN_CONFIDENCE` | `0.65` | Minimum confidence untuk trade (0-1) |
| `STRATEGY` | `expected_move` | Strategi: expected_move/orderbook/momentum/combined |
| `DRY_RUN` | `true` | true = simulasi, false = trading sungguhan |

## 🏗️ Arsitektur

```
vizo-trading-bot/
├── index.js            # Entry point & CLI
├── src/
│   ├── config.js       # Konfigurasi & environment
│   ├── api.js          # VIZO API client (semua endpoint)
│   ├── wallet.js       # Wallet management & auth
│   ├── strategies.js   # Strategi trading & TA
│   ├── risk.js         # Risk management (Kelly Criterion)
│   └── bot.js          # Main bot logic
├── .env                # Konfigurasi lokal (jangan commit!)
├── .env.example        # Template konfigurasi
└── README.md
```

## ⚠️ Disclaimer

Bot ini untuk **testnet (Base Sepolia)** dalam rangka kompetisi Tradathon. Gunakan dengan bijak. Ini bukan saran investasi.
