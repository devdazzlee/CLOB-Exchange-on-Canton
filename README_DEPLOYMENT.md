# CLOB Exchange - Quick Deployment Guide

## 🚀 Quick Start

### 1. Upload DAML Contracts

```bash
# Set JWT token (if required)
export JWT_TOKEN="your-token-here"

# Upload DAR file
./scripts/upload-dar.sh
```

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:3000

### 3. Run Tests

```bash
# Run all tests
./scripts/run-tests.sh all

# Or run specific tests
./scripts/run-tests.sh daml
./scripts/run-tests.sh frontend
```

## 📋 Configuration

### Canton Endpoints
- **JSON API:** `https://participant.dev.canton.wolfedgelabs.com/json-api`
- **Admin API (gRPC):** `participant.dev.canton.wolfedgelabs.com:443`

### Keycloak Credentials
- Username: `zoya`
- Password: `Zoya123!`

### Demo Wallet
- Party ID: `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`

## 📚 Documentation

- **Testing Guide:** [TESTING_GUIDE.md](./TESTING_GUIDE.md)
- **Deployment Guide:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Test Results:** [TEST_RESULTS.md](./TEST_RESULTS.md)

## 🔧 Troubleshooting

### DAR Upload Fails
```bash
# Install grpcurl
brew install grpcurl  # macOS
apt-get install grpcurl  # Linux

# Check connection
ping participant.dev.canton.wolfedgelabs.com
```

### Frontend Can't Connect
1. Check browser console (F12)
2. Verify API endpoint in `.env` files
3. Check CORS settings

## ✅ Pre-Deployment Checklist

- [ ] DAML contracts built (`daml build`)
- [ ] Frontend builds (`npm run build`)
- [ ] Tests pass (`./scripts/run-tests.sh all`)
- [ ] DAR uploaded to Canton
- [ ] Frontend deployed
- [ ] E2E tests pass

## 📞 Support

For issues during deployment, check:
1. [DEPLOYMENT.md](./DEPLOYMENT.md) - Full deployment guide
2. [TESTING_GUIDE.md](./TESTING_GUIDE.md) - Testing procedures
3. Browser console logs
4. Canton participant logs



