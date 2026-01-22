# Quick Start Guide

## Prerequisites

- Node.js 18+
- PostgreSQL
- Access to Canton network (65.108.40.104)
- OAuth credentials

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in:

```bash
# OAuth credentials (from requirements)
OAUTH_TOKEN_URL=https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token
OAUTH_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw
OAUTH_CLIENT_SECRET=mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYc

# Network endpoints (already configured)
JSON_API_BASE_URL=http://65.108.40.104:31539
LEDGER_GRPC_HOST=65.108.40.104
LEDGER_GRPC_PORT=31217
ADMIN_GRPC_HOST=65.108.40.104
ADMIN_GRPC_PORT=30100
SCAN_PROXY_BASE_URL=http://65.108.40.104:8088
SCAN_PROXY_PREFIX=/api/scan

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clob_exchange
```

### 3. Setup Database

```bash
# Create database
createdb clob_exchange

# Or using psql:
psql -U postgres -c "CREATE DATABASE clob_exchange;"
```

### 4. Build Packages

```bash
npm run build
```

### 5. Build DAML Contracts

```bash
cd daml/exchange
daml build
cd ../..
```

### 6. Start Services

Open 4 terminal windows:

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

### 7. Access Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Indexer API: http://localhost:3002

## First Time Setup

1. **Create Wallet**
   - Open http://localhost:3000
   - Click "Create Wallet"
   - Set password
   - Save seed phrase

2. **Onboarding**
   - Allocate external party
   - Create transfer preapproval
   - Get test funds

3. **Start Trading**
   - Select market
   - Place orders
   - View order book

## Troubleshooting

### OAuth Token Errors
- Verify credentials in `.env`
- Check network connectivity to Keycloak

### Database Connection Errors
- Ensure PostgreSQL is running
- Check `DATABASE_URL` format
- Run migrations: `cd apps/indexer && npm run migrate`

### Template Discovery Errors
- Run discovery endpoint: `GET /api/discovery/packages`
- Check network connectivity to JSON API

### Order Placement Fails
- Ensure party is allocated
- Check transfer preapproval exists
- Verify sufficient balance

## Next Steps

1. Discover actual template IDs from network
2. Complete external party allocation signing
3. Implement ledger streaming
4. Add WebSocket real-time updates
5. Deploy DAR file to participant

See `COMPLETION_SUMMARY.md` for detailed status.
