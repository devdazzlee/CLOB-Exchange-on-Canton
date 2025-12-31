# 🚀 Start Testing - CLOB Exchange

## Step 1: Create OrderBook Contracts (Required First!)

Before testing the frontend, you need to create OrderBook contracts:

```bash
# Using default operator party ID
node scripts/create-orderbook.js

# Or specify your operator party ID
node scripts/create-orderbook.js "YOUR_OPERATOR_PARTY_ID"
```

**Default Operator:** `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`

This creates OrderBooks for:
- BTC/USDT
- ETH/USDT
- SOL/USDT

---

## Step 2: Start Frontend

```bash
cd frontend
npm run dev
```

Open: **http://localhost:3000**

---

## Step 3: Test Values

### Create Wallet
- Password: `test123456`
- **SAVE** the 12-word seed phrase!

### Place Buy Order
- Trading Pair: **BTC/USDT**
- Order Type: **BUY**
- Order Mode: **LIMIT**
- Price: `42000`
- Quantity: `0.5`

### Place Sell Order
- Trading Pair: **BTC/USDT**
- Order Type: **SELL**
- Order Mode: **LIMIT**
- Price: `43000`
- Quantity: `0.3`

---

## Quick Test Checklist

- [ ] OrderBook contracts created
- [ ] Frontend started (http://localhost:3000)
- [ ] Wallet created
- [ ] Buy order placed
- [ ] Sell order placed
- [ ] Order book displays correctly
- [ ] Order cancelled successfully
- [ ] No console errors (F12)

---

## Full Testing Guide

See: **FRONTEND_TESTING_GUIDE.md**

---

**Ready to test!** 🎉
