# Quick Start Guide

Get the CLOB Exchange running in under 5 minutes.

## Prerequisites

- Node.js v18+
- DAML SDK installed
- Canton network access

## Setup

```bash
# 1. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Configure backend
cd backend
cp .env.example .env
# Edit .env with your Canton credentials

# 3. Deploy DAML contracts
cd ..
./scripts/deploy-daml.sh

# 4. Upload DAR to Canton (via Canton Console)
# participant1.dars.upload("dars/clob-exchange.dar")
```

## Start Services

```bash
# Terminal 1: Start backend with matching engine
cd backend
npm start

# Terminal 2: Start frontend
cd frontend
npm run dev
```

## Admin: Create Order Books

```bash
# Create trading pairs (required before users can trade)
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT
curl -X POST http://localhost:3001/api/admin/orderbooks/ETH%2FUSDT
curl -X POST http://localhost:3001/api/admin/orderbooks/SOL%2FUSDT
```

## Test Trading

1. **Create Wallet**:
   - Open `http://localhost:5173`
   - Click "Create New Wallet"
   - Save mnemonic and set password
   - Wait for onboarding (2-step process)

2. **Place Order**:
   - Select BTC/USDT
   - Enter price: 50000
   - Enter quantity: 0.1
   - Click "Place Buy Order"

3. **Test Matching** (Second User):
   - Open incognito window
   - Import wallet or create new one
   - Place sell order at 50000 or lower
   - **Orders match automatically within 2 seconds!**

4. **Verify**:
   - Check "Recent Trades" tab
   - Orders should be filled
   - Balance should update
   - WebSocket real-time updates working

## What You Get

✅ Full order matching engine (FIFO price-time priority)
✅ Real-time WebSocket updates
✅ Global orderbook (all users see same orders)
✅ Partial fills supported
✅ Professional Binance-style UI
✅ Wallet import/export
✅ Multiple trading pairs
✅ Self-trade prevention

## Troubleshooting

**Orders not matching?**
- Check buy price >= sell price
- Ensure matching engine is running (check backend logs)
- Verify orderbook was created by admin

**Wallet locked error?**
- Just-in-time unlock modal should appear
- Enter wallet password to sign transaction

**WebSocket not connecting?**
- Check browser console
- Verify backend running on correct port
- WebSocket URL: `ws://localhost:3001/ws`

## Next Steps

See `DEPLOYMENT.md` for:
- Production deployment
- Advanced configuration
- Full API reference
- Milestone 2 & 3 feature details

---

**Happy Trading! 🚀**
