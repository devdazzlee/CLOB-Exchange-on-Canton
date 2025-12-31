# 🚀 TEST NOW - Quick Start Guide

**Everything is ready! Follow these steps to test immediately.**

---

## ⚡ Quick Setup (One Command)

```bash
./scripts/setup-for-testing.sh
```

This will:
- ✅ Check DAML contracts
- ✅ Install frontend dependencies
- ✅ Create OrderBook contracts
- ✅ Verify everything is ready

---

## 🎯 Step-by-Step Testing

### Step 1: Run Setup Script

```bash
./scripts/setup-for-testing.sh
```

**Expected Output:**
```
✓ DAML contracts ready
✓ Frontend dependencies ready
✓ OrderBook contracts created
✓ Setup Complete!
```

---

### Step 2: Start Frontend

```bash
cd frontend
npm run dev
```

**Expected Output:**
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:3000/
➜  Network: use --host to expose
```

---

### Step 3: Open Browser

Open: **http://localhost:3000**

You should see:
- Welcome page
- "Create New Wallet" button
- "Import Existing Wallet" section

---

### Step 4: Create Wallet

1. Click **"Create New Wallet"**
2. **IMPORTANT:** Copy the 12-word seed phrase
   - Example: `abandon ability able about above absent absorb abstract abuse access accident account`
3. Enter password: `test123456`
4. Confirm password: `test123456`
5. Click **"Confirm & Create Wallet"**

**Expected:**
- ✅ Party ID displayed
- ✅ Redirected to trading interface
- ✅ "Your Balance" card visible
- ✅ "Place Order" form visible

---

### Step 5: Place Buy Order

1. In **"Place Order"** section:
2. Trading Pair: **BTC/USDT** (already selected)
3. Click **"BUY"** button (turns green)
4. Order Mode: **LIMIT** (already selected)
5. Price: Enter `42000`
6. Quantity: Enter `0.5`
7. Verify Total shows: `21000 USDT`
8. Click **"Place Order"**

**Expected:**
- ✅ Alert: "Order placed successfully!"
- ✅ Order appears in **"My Orders"**
- ✅ Order appears in **"Order Book"** under BUY ORDERS
- ✅ Order shows: Price 42000, Quantity 0.5, Status OPEN

---

### Step 6: Place Sell Order

1. In **"Place Order"** section:
2. Trading Pair: **BTC/USDT**
3. Click **"SELL"** button (turns red)
4. Order Mode: **LIMIT**
5. Price: Enter `43000`
6. Quantity: Enter `0.3`
7. Verify Total shows: `12900 USDT`
8. Click **"Place Order"**

**Expected:**
- ✅ Alert: "Order placed successfully!"
- ✅ Order appears in **"My Orders"**
- ✅ Order appears in **"Order Book"** under SELL ORDERS
- ✅ Order shows: Price 43000, Quantity 0.3, Status OPEN

---

### Step 7: View Order Book

Scroll to **"Order Book"** section:

**Expected:**
- ✅ **BUY ORDERS** section (green/blue theme)
  - Shows your buy order at 42000
  - Sorted highest price first
- ✅ **SELL ORDERS** section (red theme)
  - Shows your sell order at 43000
  - Sorted lowest price first
- ✅ Each order shows: Price | Quantity | Total
- ✅ Order book auto-refreshes every 5 seconds

---

### Step 8: Cancel Order

1. Scroll to **"My Orders"** section
2. Find an order with status **"OPEN"**
3. Click **"Cancel"** button
4. Confirm in popup

**Expected:**
- ✅ Alert: "Order cancelled successfully!"
- ✅ Order disappears from "My Orders"
- ✅ Order removed from "Order Book"
- ✅ Order status changes to "CANCELLED"

---

## ✅ Success Checklist

After completing all steps, verify:

- [ ] Wallet created successfully
- [ ] Party ID displayed
- [ ] Buy order placed
- [ ] Sell order placed
- [ ] Orders visible in order book
- [ ] Orders visible in "My Orders"
- [ ] Order cancelled successfully
- [ ] Order book updates automatically
- [ ] No errors in browser console (F12)

---

## 🐛 Troubleshooting

### Issue: "Order book not found"

**Solution:**
```bash
# Create OrderBooks manually
node scripts/create-orderbook.js
```

### Issue: Frontend won't start

**Solution:**
```bash
cd frontend
rm -rf node_modules
npm install
npm run dev
```

### Issue: CORS errors in browser

**Check:**
1. Open browser console (F12)
2. Check Network tab
3. Verify API calls to: `https://participant.dev.canton.wolfedgelabs.com/json-api`

**Solution:**
- API endpoint is correct
- Canton node is accessible
- Check browser console for specific errors

### Issue: Orders not appearing

**Check:**
1. Browser console (F12) for errors
2. Network tab for failed API calls
3. Verify OrderBook exists for trading pair

**Solution:**
```bash
# Recreate OrderBooks
node scripts/create-orderbook.js
```

---

## 📊 Test Values Reference

| Action | Value |
|--------|-------|
| Password | `test123456` |
| Buy Order - Pair | `BTC/USDT` |
| Buy Order - Type | `BUY` |
| Buy Order - Mode | `LIMIT` |
| Buy Order - Price | `42000` |
| Buy Order - Quantity | `0.5` |
| Buy Order - Total | `21000 USDT` |
| Sell Order - Pair | `BTC/USDT` |
| Sell Order - Type | `SELL` |
| Sell Order - Mode | `LIMIT` |
| Sell Order - Price | `43000` |
| Sell Order - Quantity | `0.3` |
| Sell Order - Total | `12900 USDT` |

---

## 🎬 What You Should See

### After Wallet Creation:
- Party ID displayed (long string)
- Trading interface loaded
- Balance card showing BTC: 0.0, USDT: 0.0
- Place Order form ready

### After Placing Orders:
- Success alerts
- Orders in "My Orders" table
- Orders in "Order Book"
- Order book updating every 5 seconds

### Browser Console (F12):
- No red errors
- Successful API calls
- Status 200/201 responses

---

## 📸 Screenshots to Take

1. **Wallet Created:** Party ID displayed
2. **Order Placed:** Success message
3. **Order Book:** Buy and sell orders visible
4. **My Orders:** List of orders
5. **Browser Console:** No errors

---

## 🎉 You're Ready!

Everything is set up. Just run:

```bash
./scripts/setup-for-testing.sh
cd frontend && npm run dev
```

Then open **http://localhost:3000** and start testing!

---

**Need Help?** Check:
- `FRONTEND_TESTING_GUIDE.md` - Detailed guide
- `START_TESTING.md` - Quick reference
- Browser console (F12) - For errors

---

**Status:** ✅ Ready to Test Now!

