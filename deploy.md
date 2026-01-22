# Deployment Guide

## Prerequisites

- Node.js 18+
- PostgreSQL
- Access to Canton network endpoints
- OAuth credentials (Client ID and Secret)

## Environment Setup

1. Copy `.env.example` to `.env` and fill in:
   - OAuth credentials
   - Database URL
   - Network endpoints

## DAML Build & Deploy

1. Build DAR:
```bash
cd daml/exchange
daml build
```

2. Upload DAR to participant:
```bash
# Using Admin API
curl -X POST http://65.108.40.104:30100/v1/participants/upload-dar \
  -H "Authorization: Bearer <admin-token>" \
  -F "dar=@.daml/dist/clob-exchange-1.0.0.dar"
```

Or use the provided script:
```bash
./scripts/upload-dar.sh
```

## Database Setup

1. Create database:
```sql
CREATE DATABASE clob_exchange;
```

2. Run migrations (when indexer is implemented):
```bash
cd apps/indexer
npm run migrate
```

## Start Services

1. Start backend API:
```bash
cd apps/api
npm start
```

2. Start indexer:
```bash
cd apps/indexer
npm start
```

3. Start matcher:
```bash
cd apps/matcher
npm start
```

4. Start frontend:
```bash
cd apps/web
npm run dev
```

## Verification

1. Check health endpoints:
   - Backend: `http://localhost:3001/health`
   - Indexer: `http://localhost:3002/health`
   - Matcher: `http://localhost:3003/health`

2. Test onboarding flow:
   - Create wallet in UI
   - Allocate external party
   - Verify transfer preapproval exists

## Troubleshooting

- **OAuth token errors**: Verify credentials in `.env`
- **Database connection**: Check `DATABASE_URL` format
- **DAR upload fails**: Verify admin token and participant endpoint
- **Party allocation fails**: Check network connectivity and OAuth token
