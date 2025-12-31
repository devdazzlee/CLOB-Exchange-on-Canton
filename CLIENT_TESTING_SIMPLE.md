# 🌐 Client Testing - Simple Guide

**Status:** ✅ Ready for Testing  
**No Automation** - OrderBooks must be created first

---

## 🚀 For You (Before Client Testing)

### Step 1: Create OrderBooks (Required First!)

```bash
node scripts/create-orderbook.js
```

This creates OrderBooks for:
- BTC/USDT
- ETH/USDT  
- SOL/USDT

### Step 2: Start Frontend

```bash
cd frontend
npm run dev
```

### Step 3: Share Link with Client

Share: **http://localhost:3000**

---

## 📋 For Your Client

### Step 1: Open Link
Open: **http://localhost:3000**

### Step 2: Create Wallet
1. Click **"Create New Wallet"**
2. **SAVE** the 12-word seed phrase
3. Enter password: `test123456`
4. Confirm password: `test123456`
5. Click **"Confirm & Create Wallet"**

### Step 3: Place Buy Order
- Trading Pair: **BTC/USDT**
- Click **BUY** (green)
- Order Mode: **LIMIT**
- Price: `42000`
- Quantity: `0.5`
- Click **"Place Order"**

### Step 4: Place Sell Order
- Trading Pair: **BTC/USDT**
- Click **SELL** (red)
- Order Mode: **LIMIT**
- Price: `43000`
- Quantity: `0.3`
- Click **"Place Order"**

### Step 5: View Order Book
- Check "Order Book" section
- Buy orders (highest price first)
- Sell orders (lowest price first)

### Step 6: Cancel Order
- Go to "My Orders"
- Click "Cancel" on an order
- Confirm

---

## ✅ Expected Results

- ✅ Wallet created successfully
- ✅ Orders placed successfully
- ✅ Order book displays correctly
- ✅ Orders can be cancelled
- ✅ No console errors (F12)

---

## 🐛 Troubleshooting

**"Order book not found":**
- You need to create OrderBooks first:
  ```bash
  node scripts/create-orderbook.js
  ```

**"Buffer is not defined":**
- This is now fixed
- Refresh page if you see this error

**CORS errors:**
- Check browser console (F12)
- Verify internet connection

---

## 📊 Test Values

| Item | Value |
|------|-------|
| Password | `test123456` |
| Buy Price | `42000` |
| Buy Quantity | `0.5` |
| Sell Price | `43000` |
| Sell Quantity | `0.3` |
| Trading Pair | `BTC/USDT` |

---

**Status:** ✅ Ready - Just create OrderBooks first, then share link!

