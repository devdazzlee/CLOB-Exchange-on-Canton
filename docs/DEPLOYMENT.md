# CLOB Exchange Deployment Guide

Complete guide for deploying the CLOB Exchange on Canton with all Milestone 2 & 3 features.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [DAML Contract Deployment](#daml-contract-deployment)
4. [Backend Setup](#backend-setup)
5. [Frontend Setup](#frontend-setup)
6. [Matching Engine](#matching-engine)
7. [Admin Operations](#admin-operations)
8. [Verification](#verification)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js** v18+ and npm
- **DAML SDK** 2.7.0+
- **Canton Network** access (devnet or local)
- **PostgreSQL** (optional, for production)

### Canton Access

You need access to a Canton network with:
- Canton JSON API v2 endpoint (default: `http://65.108.40.104:31539`)
- Canton Admin API (for contract deployment)
- Keycloak OAuth credentials (validator-app client)

---

## Environment Setup

### 1. Clone & Install Dependencies

```bash
cd "CLOB Exchange/CLOB-Exchange-on-Canton"

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Backend Environment

Copy and configure `.env`:

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```bash
# Server
PORT=3001
NODE_ENV=development

# Canton JSON API v2
CANTON_JSON_API_BASE=http://65.108.40.104:31539

# Canton OAuth (validator-app client)
CANTON_OAUTH_TOKEN_URL=https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token
CANTON_OAUTH_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw
CANTON_OAUTH_CLIENT_SECRET=<your-secret>

# Optional: Override synchronizer ID (auto-discovered if not set)
# CANTON_SYNCHRONIZER_ID=global-domain::1220...

# Operator Party ID (admin party)
OPERATOR_PARTY_ID=8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292

# Matching Engine
ENABLE_MATCHING_ENGINE=true

# Keycloak (for legacy auth)
KEYCLOAK_BASE_URL=https://keycloak.wolfedgelabs.com:8443
KEYCLOAK_REALM=canton-devnet
KEYCLOAK_ADMIN_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw
KEYCLOAK_ADMIN_CLIENT_SECRET=<your-secret>
```

### 3. Configure Frontend Environment

```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:

```bash
VITE_API_BASE_URL=http://localhost:3001/api
```

---

## DAML Contract Deployment

### Option 1: Using Deployment Script (Recommended)

```bash
cd "CLOB Exchange/CLOB-Exchange-on-Canton"
./scripts/deploy-daml.sh
```

This will:
1. Build DAML contracts
2. Generate `.dar` file
3. Output deployment instructions

### Option 2: Manual Deployment

```bash
# Build contracts
cd daml
daml build

# Find the DAR file
DAR_FILE=$(find .daml/dist -name "*.dar" | head -n 1)
echo "DAR file: $DAR_FILE"

# Upload via Canton Console
# Connect to Canton and run:
# participant1.dars.upload("path/to/clob-exchange.dar")
```

### Verify Deployment

Check that packages are uploaded:

```bash
# Via Canton Console
participant1.dars.list()

# Should show:
# - MasterOrderBook
# - Order
# - Trade
# - (other contracts)
```

---

## Backend Setup

### 1. Start Backend Server

```bash
cd backend
npm start
```

You should see:

```
╔═══════════════════════════════════════════════════════════════╗
║           CLOB Exchange Backend Server                         ║
╚═══════════════════════════════════════════════════════════════╝

✓ Server running on port 3001 (0.0.0.0:3001)
✓ WebSocket server available at ws://localhost:3001/ws
✓ Environment: development

🤖 Starting Matching Engine...
✓ Matching Engine started successfully
  Polling interval: 2000ms
```

### 2. Verify Backend Health

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-22T...",
  "uptime": 123.456
}
```

---

## Frontend Setup

### 1. Start Frontend Dev Server

```bash
cd frontend
npm run dev
```

### 2. Access Application

Open browser: `http://localhost:5173`

You should see the wallet setup screen.

---

## Matching Engine

The matching engine is **critical** for order execution. It runs automatically when backend starts (if `ENABLE_MATCHING_ENGINE=true`).

### How It Works

1. **Polling**: Checks for matching orders every 2 seconds
2. **FIFO Execution**: Price-time priority (best price first, then earliest order)
3. **Self-Trade Prevention**: Won't match orders from the same user
4. **Partial Fills**: Handles mismatched sizes and creates remainder orders
5. **Real-Time Updates**: Emits WebSocket events when matches occur

### Manual Control

#### Start Only Matching Engine:

```bash
./scripts/start-matching-engine.sh
```

#### Disable Matching Engine:

Edit `backend/.env`:

```bash
ENABLE_MATCHING_ENGINE=false
```

### Monitoring

Check matching engine logs in backend console:

```
[MatchingEngine] Processing order book: BTC/USDT
[MatchingEngine] Found 1 potential matches for BTC/USDT
[MatchingEngine] Executing match:
  Buy Order: 00123...
  Sell Order: 00456...
[MatchingEngine] ✓ Match executed successfully
[MatchingEngine] ✓ WebSocket events emitted
```

---

## Admin Operations

### 1. Create Global Order Books

**IMPORTANT**: Admin must create global orderbooks for each trading pair before users can trade.

```bash
# Create BTC/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT

# Create ETH/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/ETH%2FUSDT

# Create SOL/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/SOL%2FUSDT
```

Response:

```json
{
  "success": true,
  "message": "OrderBook created successfully",
  "data": {
    "contractId": "00123abc...",
    "masterOrderBookContractId": "00456def...",
    "tradingPair": "BTC/USDT"
  }
}
```

### 2. Verify Order Books

```bash
curl http://localhost:3001/api/orderbooks
```

Should show all created orderbooks with 0 orders initially.

---

## Verification

### ✅ Complete End-to-End Test

#### Step 1: User Onboarding

1. Open `http://localhost:5173`
2. Click "Create New Wallet"
3. Save mnemonic phrase
4. Set password
5. Wait for party allocation (2-step process)
6. Should see "Wallet Ready" with Party ID

#### Step 2: Place Order

1. Navigate to Trading Interface
2. Select trading pair (e.g., BTC/USDT)
3. Enter price and quantity
4. Click "Place Buy Order" or "Place Sell Order"
5. Order should appear in "My Open Orders"

#### Step 3: Match Orders (Second User)

1. Import wallet in incognito window (or different browser)
2. Navigate to Trading Interface
3. Place opposing order (if you placed buy, place sell)
4. **Matching engine should execute within 2 seconds**
5. Check "Recent Trades" for executed trade

#### Step 4: Verify Real-Time Updates

1. Open browser console (F12)
2. Watch for WebSocket messages:
   ```
   WebSocket connected
   Subscribed to orderbook:BTC/USDT
   Update received: { type: "MATCH", ... }
   ```

3. Order book should update automatically (no page refresh)

---

## Milestone 2 & 3 Checklist

### ✅ Milestone 2: Matching Engine & Core Logic

- ✅ **Limit Order Contract**: Order.daml with asset locking
- ✅ **Market Order Logic**: Market orders supported
- ✅ **Asset Locking**: Funds locked on order placement
- ✅ **Matching Engine**: Automated bot running every 2 seconds
- ✅ **FIFO Execution**: Price-time priority implemented
- ✅ **Self-Trade Check**: Prevents matching own orders
- ✅ **Full Execution**: Trade settlement when amounts match
- ✅ **Partial Fills**: Remainder orders created for mismatched sizes
- ✅ **Cancellation Logic**: Cancel choice with immediate refund

### ✅ Milestone 3: Professional UI & Real-Time Data

- ✅ **Visual Order Book**: Aggregated bids (green) and asks (red)
- ✅ **Depth Display**: Volume bars showing liquidity
- ✅ **Spread Display**: Price difference between bid and ask
- ✅ **Real-Time Updates**: WebSocket live order book updates
- ✅ **Trade Ticker**: Last 10-20 trades displayed
- ✅ **Balance Sync**: Instant balance updates on trades
- ✅ **My Open Orders**: Table with cancel buttons
- ✅ **Partial Fill Status**: Shows "Filled: X%" for partial orders
- ✅ **Order History**: Completed/cancelled orders tab
- ✅ **Multiple Pairs**: Dropdown to switch trading pairs
- ✅ **Context Switching**: Refreshes data when pair changes

---

## Troubleshooting

### Issue: Matching Engine Not Starting

**Solution**:

```bash
# Check .env
ENABLE_MATCHING_ENGINE=true

# Check logs for errors
# Common issue: Missing OAuth credentials
```

### Issue: Orders Not Matching

**Possible Causes**:

1. **Price doesn't overlap**: Buy price must be >= Sell price
2. **Self-trade**: Same user placed both orders
3. **Matching engine disabled**: Check `ENABLE_MATCHING_ENGINE=true`
4. **No global orderbook**: Admin must create orderbook first

**Debug**:

```bash
# Check matching engine logs
# Should see "Processing order book: BTC/USDT"

# If no logs, matching engine isn't running
```

### Issue: WebSocket Not Connecting

**Solution**:

```bash
# Check WebSocket endpoint in frontend
# Should be: ws://localhost:3001/ws

# Check browser console for errors
# Common: CORS or port mismatch
```

### Issue: Wallet Import Not Working

**Solution**:

1. Ensure 12-word mnemonic is correct
2. Check that wallet was created with this app (uses BIP44 m/44'/501'/0'/0')
3. Try creating new wallet if import fails

### Issue: Global Orderbook Not Visible

**Solution**:

```bash
# Admin must create orderbook first
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT

# Verify it exists
curl http://localhost:3001/api/orderbooks
```

### Issue: "Splice packages not installed"

**Note**: The DAML contracts have Splice imports commented out. This is expected until Splice packages are installed in your Canton network. The basic order matching still works without Splice.

**To enable Splice**:

1. Install Splice packages in Canton
2. Uncomment imports in `daml/MasterOrderBook.daml`
3. Rebuild and redeploy contracts

---

## Production Deployment

### Additional Steps for Production:

1. **Environment**:
   ```bash
   NODE_ENV=production
   ```

2. **HTTPS**: Use reverse proxy (nginx/traefik)

3. **Database**: Replace localStorage with PostgreSQL

4. **Rate Limiting**: Add rate limiting to API

5. **Monitoring**: Set up logging (Winston/Datadog)

6. **Backups**: Regular contract state backups

7. **Scaling**: Run multiple matching engine instances with coordination

---

## Support & Resources

- **DAML Docs**: https://docs.daml.com
- **Canton Docs**: https://docs.daml.com/canton/
- **Project Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **API Documentation**: See `ONBOARDING_API.md`

---

## Quick Start Summary

```bash
# 1. Deploy contracts
./scripts/deploy-daml.sh

# 2. Upload DAR to Canton (via Canton Console)
# participant1.dars.upload("dars/clob-exchange.dar")

# 3. Create orderbooks
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT

# 4. Start backend (with matching engine)
cd backend && npm start

# 5. Start frontend
cd frontend && npm run dev

# 6. Access app
# http://localhost:5173
```

---

**Congratulations! Your CLOB Exchange is now fully deployed with:**

- ✅ External party onboarding (2-step Canton flow)
- ✅ Automated order matching (FIFO with price-time priority)
- ✅ Real-time WebSocket updates
- ✅ Global orderbooks visible to all users
- ✅ Partial fill support
- ✅ Professional Binance-style UI
- ✅ Multiple trading pairs
- ✅ Wallet import/export

The exchange is production-ready for testing!
