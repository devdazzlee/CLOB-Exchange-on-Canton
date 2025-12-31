# 🚀 CLOB Exchange - Quick Start Guide

## For Client Testing

### Step 1: Start the Application

```bash
cd frontend
npm install  # If not already done
npm run dev
```

Open: **http://localhost:3000**

### Step 2: Follow Testing Guide

Read: **[TESTING_GUIDE.md](./TESTING_GUIDE.md)**

Complete all 10 test scenarios.

---

## For Developers

### Deploy DAML Contracts

```bash
# Set JWT token (if required)
export JWT_TOKEN="your-token-here"

# Upload DAR file
./scripts/upload-dar.sh
```

### Build Production

```bash
./scripts/build-production.sh
```

### Run Tests

```bash
./scripts/run-tests.sh all
```

---

## Key Files

- **TESTING_GUIDE.md** - Complete client testing guide
- **DEPLOYMENT.md** - Production deployment guide
- **README_DEPLOYMENT.md** - Quick reference

---

## Configuration

- **Canton JSON API:** https://participant.dev.canton.wolfedgelabs.com/json-api
- **Keycloak:** Username `zoya`, Password `Zoya123!`
- **Demo Wallet:** `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`

---

**Ready for testing!** 🎉
