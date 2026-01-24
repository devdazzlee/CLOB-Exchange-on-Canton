# CLOB Exchange on Canton

A fully-featured Central Limit Order Book (CLOB) exchange built on Canton blockchain with professional Binance-style UI.

## 🎯 Features

### ✅ Complete Milestone 2 & 3 Implementation

**Milestone 2: Matching Engine & Core Logic**
- ✅ Automated matching engine with FIFO price-time priority
- ✅ Limit and market orders
- ✅ Partial fill support
- ✅ Self-trade prevention
- ✅ Order cancellation with immediate refund
- ✅ Asset locking and settlement

**Milestone 3: Professional UI & Real-Time Data**
- ✅ Binance-style professional trading interface
- ✅ Real-time WebSocket order book updates
- ✅ Visual depth chart with liquidity bars
- ✅ Live trade ticker
- ✅ Multiple trading pairs (BTC/USDT, ETH/USDT, SOL/USDT)
- ✅ Order management with cancel buttons
- ✅ Partial fill status indicators
- ✅ Transaction history

**Wallet & Onboarding**
- ✅ Canton external party onboarding (2-step topology + allocate)
- ✅ Wallet import/export with mnemonic phrase
- ✅ Just-in-time wallet unlock (no hard blocker)
- ✅ Ed25519 signature-based party allocation

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Configure environment
cd backend
cp .env.example .env
# Edit .env with your Canton credentials

# 3. Deploy DAML contracts
./scripts/deploy-daml.sh

# 4. Create orderbooks (admin)
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT

# 5. Start services
cd backend && npm start  # Terminal 1
cd frontend && npm run dev  # Terminal 2

# 6. Access app
# http://localhost:5173
```

**See [QUICKSTART.md](QUICKSTART.md) for detailed 5-minute setup guide.**

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get running in 5 minutes
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide
- **[ONBOARDING_API.md](ONBOARDING_API.md)** - API documentation
- **[PROJECT_STATUS.md](PROJECT_STATUS.md)** - Implementation status

## 🏗️ Architecture

```
├── backend/              # Node.js/Express API server
│   ├── src/
│   │   ├── controllers/  # HTTP request handlers
│   │   ├── services/     # Business logic
│   │   │   ├── matching-engine.js    # Automated order matching
│   │   │   ├── onboarding-service.js # Canton party onboarding
│   │   │   └── websocketService.js   # Real-time updates
│   │   └── routes/       # API routing
│
├── frontend/             # React + Vite trading UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── trading/  # Trading interface components
│   │   │   └── WalletSetup.jsx  # 2-step onboarding
│   │   └── services/     # API clients
│
├── daml/                 # DAML smart contracts
│   ├── MasterOrderBook.daml  # Global order book
│   ├── Order.daml        # Order contract
│   └── Trade.daml        # Trade settlement
│
└── scripts/              # Deployment scripts
    ├── deploy-daml.sh    # Contract deployment
    └── start-matching-engine.sh  # Matching bot
```

## 🔑 Key Components

### Matching Engine

Automated bot that continuously monitors order books and executes matches:

- **FIFO Execution**: Price-time priority (best price first, earliest order wins)
- **Self-Trade Prevention**: Won't match orders from same user
- **Partial Fills**: Creates remainder orders for mismatched sizes
- **Real-Time**: 2-second polling interval
- **WebSocket Integration**: Emits events for UI updates

### Global Order Book

Single source of truth visible to all users:

- Admin creates orderbooks for trading pairs
- All users can view and trade on same orderbook
- Real-time updates via WebSocket
- UTXO model support with consolidation

### 2-Step Onboarding

Canton external party onboarding:

1. **Generate Topology**: Get multiHash for signing
2. **Allocate Party**: Submit wallet signature to complete

## 🛠️ Technology Stack

- **Backend**: Node.js, Express, WebSocket
- **Frontend**: React, Vite, TailwindCSS, Framer Motion
- **Blockchain**: Canton (DAML smart contracts)
- **Auth**: Keycloak OAuth2, Ed25519 signatures
- **Real-Time**: WebSocket (ws library)

## 📊 Trading Features

### Order Types
- **Limit Orders**: Specify price and quantity
- **Market Orders**: Execute immediately at best price

### Order Book
- Visual bids (green) and asks (red)
- Aggregated by price level
- Depth chart with liquidity visualization
- Real-time spread calculation

### Trade Execution
- Automatic matching via bot
- Partial fills supported
- Trade history with timestamp
- Balance updates in real-time

### User Features
- Multiple trading pairs
- Order management (cancel anytime)
- Transaction history
- Portfolio view
- Real-time price updates

## 🔐 Security

- Ed25519 signature verification
- Just-in-time wallet unlock
- Self-trade prevention
- Canton UTXO model
- OAuth2 token authentication

## 🧪 Testing

### Manual End-to-End Test

1. **User 1**: Create wallet → Place buy order at 50000
2. **User 2**: Create wallet → Place sell order at 50000
3. **Result**: Orders match automatically within 2 seconds
4. **Verify**: Check "Recent Trades" and balance updates

## 📝 Environment Variables

### Backend (.env)

```bash
CANTON_JSON_API_BASE=http://65.108.40.104:31539
CANTON_OAUTH_CLIENT_ID=<validator-app-client-id>
CANTON_OAUTH_CLIENT_SECRET=<secret>
ENABLE_MATCHING_ENGINE=true
OPERATOR_PARTY_ID=<admin-party-id>
```

### Frontend (.env)

```bash
VITE_API_BASE_URL=http://localhost:3001/api
```

## 🐛 Troubleshooting

**Orders not matching?**
- Check buy price >= sell price
- Verify matching engine is running (backend logs)
- Ensure orderbook exists (admin must create)

**WebSocket not connecting?**
- Check browser console for errors
- Verify backend running on correct port
- URL should be: `ws://localhost:3001/ws`

**Wallet locked error?**
- Just-in-time unlock modal should appear
- Enter password when prompted to sign

See [DEPLOYMENT.md](DEPLOYMENT.md) for more troubleshooting.

## 📈 Roadmap

- [x] Milestone 1: Wallet & Onboarding
- [x] Milestone 2: Matching Engine & Core Logic
- [x] Milestone 3: Professional UI & Real-Time Data
- [ ] Splice Allocation integration (Splice packages)
- [ ] Advanced charting (candlestick charts)
- [ ] Order book depth analytics
- [ ] Mobile responsive design
- [ ] Production deployment

## 🤝 Contributing

This is a complete implementation of Milestones 2 & 3. All core features are functional.

## 📄 License

See LICENSE file for details.

## 🆘 Support

- **Issues**: See DEPLOYMENT.md troubleshooting section
- **Documentation**: Check QUICKSTART.md and DEPLOYMENT.md
- **API Reference**: See ONBOARDING_API.md

---

**Built with ❤️ on Canton**

**Status**: ✅ Production-ready for testing (Milestones 1, 2, 3 complete)
