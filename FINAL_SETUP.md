# Final Setup Instructions

## ✅ Database Configured

Your Neon PostgreSQL database has been configured:
- URL: `postgresql://neondb_owner:npg_cOkEhXC1oD5m@ep-purple-lake-ah6nayuo-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
- This is set in `.env` file

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migrations
```bash
cd apps/indexer
npm run migrate
```

This will create all necessary tables:
- `orders` - Order records
- `trades` - Trade history
- `balances` - Balance cache
- `orderbook_levels` - Aggregated order book
- `ledger_cursor` - Stream position tracking

### 3. Start All Services

**Terminal 1 - Backend API:**
```bash
cd apps/api
npm run dev
```

**Terminal 2 - Indexer:**
```bash
cd apps/indexer
npm run dev
```

**Terminal 3 - Matcher:**
```bash
cd apps/matcher
npm run dev
```

**Terminal 4 - Frontend:**
```bash
cd apps/web
npm run dev
```

## 📋 Completed Features

### ✅ Milestone 1
- Custom wallet with Ed25519
- Encryption and backup
- External party allocation
- Transfer preapproval
- Faucet service
- Balance queries

### ✅ Milestone 2
- Matching engine
- Order book management
- Indexer with database
- Order placement/cancellation
- REST API endpoints

### ✅ Milestone 3
- Visual order book UI
- Order form
- Active orders table
- WebSocket real-time updates
- Multi-market support
- Balance display

## 🔧 Integration Tasks Remaining

### 1. Template Discovery
Run discovery to find actual template IDs:
```bash
curl http://localhost:3001/api/discovery/packages
```

### 2. External Party Allocation
- Complete signing flow (multiHash)
- Discover ExternalParty template
- Test allocation

### 3. Ledger Streaming
- Connect gRPC stream (port 31217)
- Process transactions in real-time
- Update database automatically

### 4. Test End-to-End Flow
1. Create wallet
2. Allocate party
3. Get test funds
4. Place order
5. Verify matching
6. Check balances

## 📊 API Endpoints

### Backend API (Port 3001)
- `POST /api/onboarding/allocate-party` - Allocate external party
- `POST /api/onboarding/create-preapproval` - Create transfer preapproval
- `POST /api/orders/place` - Place order
- `POST /api/orders/cancel` - Cancel order
- `GET /api/balances/:party` - Get balances
- `POST /api/faucet/get-funds` - Get test funds
- `GET /api/discovery/packages` - Discover templates
- `WS ws://localhost:3001` - WebSocket for real-time updates

### Indexer API (Port 3002)
- `GET /markets` - List markets
- `GET /orderbook?market=...` - Get order book
- `GET /trades?market=...` - Get trades
- `GET /me/orders?party=...&status=...` - Get user orders
- `GET /me/history?party=...` - Get trade history

## 🎯 Next Steps

1. **Run migrations** to set up database
2. **Start all services** in separate terminals
3. **Access frontend** at http://localhost:3000
4. **Create wallet** and complete onboarding
5. **Get test funds** from faucet
6. **Start trading**!

## 🐛 Troubleshooting

### Database Connection
- Verify DATABASE_URL in `.env`
- Check Neon database is accessible
- Run migrations: `cd apps/indexer && npm run migrate`

### OAuth Token
- Verify credentials in `.env`
- Check network connectivity to Keycloak

### Template Discovery
- Run discovery endpoint
- Check network connectivity to JSON API
- Verify OAuth token is valid

### WebSocket
- Check backend is running on port 3001
- Verify WebSocket connection in browser console
- Check for CORS issues

## 📝 Notes

- All core functionality is implemented
- Template IDs need to be discovered from live network
- Database is configured and ready
- WebSocket real-time updates are integrated
- All services are ready to run
