# 🧪 Frontend Testing Guide - CLOB Exchange

**Date:** December 31, 2024  
**Status:** Ready for Testing  
**Frontend URL:** http://localhost:3000

---

## 🚀 Quick Start

### 1. Start Frontend

```bash
cd frontend
npm install  # If not already done
npm run dev
```

Open browser: **http://localhost:3000**

---

## 📋 Step-by-Step Testing Guide

### **TEST 1: Create New Wallet** ✅

**Steps:**
1. Open http://localhost:3000
2. Click **"Create New Wallet"** button
3. **IMPORTANT:** A 12-word seed phrase will appear
4. **SAVE THIS SEED PHRASE** - Write it down or copy it
   - Example: `abandon ability able about above absent absorb abstract abuse access accident account`
5. Enter password: `test123456` (minimum 8 characters)
6. Confirm password: `test123456`
7. Click **"Confirm & Create Wallet"**

**Expected Results:**
- ✅ Wallet created successfully
- ✅ Party ID displayed (long string starting with party ID format)
- ✅ Redirected to trading interface
- ✅ No error messages

**Screenshot:** Take screenshot of Party ID

---

### **TEST 2: Import Existing Wallet** ✅

**Steps:**
1. Click browser back or go to http://localhost:3000
2. Scroll to **"Import Existing Wallet"** section
3. Enter the seed phrase from TEST 1 (all 12 words)
4. Enter password: `test123456`
5. Click **"Import Wallet"**

**Expected Results:**
- ✅ Same Party ID as TEST 1 appears
- ✅ Wallet imported successfully
- ✅ Redirected to trading interface

**Verification:** Compare Party ID with TEST 1 - should be identical

---

### **TEST 3: Check Balance Display** ✅

**Steps:**
1. After wallet is ready, you should see **"Your Balance"** card
2. Check displayed balances:
   - BTC: Should show `0.0` (or actual balance if account exists)
   - USDT: Should show `0.0` (or actual balance if account exists)

**Expected Results:**
- ✅ Balance card visible
- ✅ BTC and USDT balances displayed
- ✅ Numbers shown (not NaN or undefined)

**Note:** Initial balances will be 0.0 until UserAccount contract is created

---

### **TEST 4: Place Buy Order (LIMIT)** ✅

**Steps:**
1. In **"Place Order"** section:
2. Select Trading Pair: **BTC/USDT**
3. Click **"BUY"** button (should turn green/active)
4. Select Order Mode: **LIMIT**
5. Enter Price: `42000`
6. Enter Quantity: `0.5`
7. Verify Total shows: `21000 USDT` (Price × Quantity)
8. Click **"Place Order"** button

**Expected Results:**
- ✅ Success message: "Order placed successfully!"
- ✅ Order appears in **"My Orders"** section
- ✅ Order appears in **"Order Book"** under **BUY ORDERS**
- ✅ Order shows status: **"OPEN"**
- ✅ Price, Quantity, and Remaining displayed correctly

**Screenshot:** Order book showing your buy order

---

### **TEST 5: Place Sell Order (LIMIT)** ✅

**Steps:**
1. In **"Place Order"** section:
2. Select Trading Pair: **BTC/USDT**
3. Click **"SELL"** button (should turn red/active)
4. Select Order Mode: **LIMIT**
5. Enter Price: `43000`
6. Enter Quantity: `0.3`
7. Verify Total shows: `12900 USDT`
8. Click **"Place Order"**

**Expected Results:**
- ✅ Success message appears
- ✅ Order appears in **"My Orders"**
- ✅ Order appears in **"Order Book"** under **SELL ORDERS**
- ✅ Sell orders sorted from **lowest to highest** price
- ✅ Buy orders sorted from **highest to lowest** price

**Verification:** Check order book - sell orders should be in ascending price order

---

### **TEST 6: View Order Book** ✅

**Steps:**
1. Scroll to **"Order Book"** section
2. Observe the display

**Expected Results:**
- ✅ **BUY ORDERS** section visible (green/blue theme)
- ✅ **SELL ORDERS** section visible (red theme)
- ✅ Buy orders sorted: **Highest price first** (43000, 42000, 41000...)
- ✅ Sell orders sorted: **Lowest price first** (43000, 44000, 45000...)
- ✅ Each order shows:
  - Price
  - Quantity (remaining quantity, not total)
  - Total (Price × Remaining Quantity)
- ✅ Order book updates automatically every 5 seconds

**Checklist:**
- [ ] Buy orders visible
- [ ] Sell orders visible
- [ ] Correct sorting
- [ ] Price displayed correctly
- [ ] Quantity displayed correctly
- [ ] Total calculated correctly

---

### **TEST 7: Cancel Order** ✅

**Steps:**
1. Go to **"My Orders"** section
2. Find an order with status **"OPEN"**
3. Click **"Cancel"** button next to the order
4. Confirm cancellation in popup

**Expected Results:**
- ✅ Order disappears from **"My Orders"** list
- ✅ Order removed from **"Order Book"**
- ✅ Success message: "Order cancelled successfully!"
- ✅ Order status changes to **"CANCELLED"** (if still visible)

**Verification:** Check order book - cancelled order should not appear

---

### **TEST 8: Place Market Order** ✅

**Steps:**
1. In **"Place Order"** section:
2. Select Trading Pair: **BTC/USDT**
3. Click **"BUY"** button
4. Select Order Mode: **MARKET**
5. **Note:** Price field should be disabled/grayed out
6. Enter Quantity: `0.1`
7. Click **"Place Order"**

**Expected Results:**
- ✅ Price field disabled for market orders
- ✅ Order placed successfully
- ✅ Order appears in order book
- ✅ Order shows as market order (no price or special indicator)

---

### **TEST 9: Multiple Trading Pairs** ✅

**Steps:**
1. Place order for **BTC/USDT**
2. Change Trading Pair to **ETH/USDT**
3. Place order for **ETH/USDT**
4. Switch back to **BTC/USDT**
5. Check order book for each pair

**Expected Results:**
- ✅ Order book shows correct orders for selected pair
- ✅ Orders don't mix between pairs
- ✅ **"My Orders"** shows orders from all pairs
- ✅ Can switch between pairs seamlessly

---

### **TEST 10: Error Handling** ✅

#### Test 10A: Invalid Price
**Steps:**
1. Try to place LIMIT order with price: `-100` (negative)
2. Try to place order

**Expected:** Error message "Price required for limit orders" or validation error

#### Test 10B: Invalid Quantity
**Steps:**
1. Try to place order with quantity: `0` or negative
2. Try to place order

**Expected:** Error message "Invalid quantity"

#### Test 10C: Empty Fields
**Steps:**
1. Leave quantity empty
2. Try to place order

**Expected:** Error message or fields highlighted in red

#### Test 10D: Order Book Not Found
**Steps:**
1. If OrderBook doesn't exist for a pair
2. Try to place order

**Expected:** Error message "Order book not found. Please contact operator to create one."

---

## 🎯 Test Values Reference

### Recommended Test Values

| Test | Trading Pair | Order Type | Order Mode | Price | Quantity | Total |
|------|--------------|------------|------------|------|----------|-------|
| Test 4 | BTC/USDT | BUY | LIMIT | 42000 | 0.5 | 21000 |
| Test 5 | BTC/USDT | SELL | LIMIT | 43000 | 0.3 | 12900 |
| Test 8 | BTC/USDT | BUY | MARKET | N/A | 0.1 | N/A |
| Test 9 | ETH/USDT | BUY | LIMIT | 2500 | 1.0 | 2500 |

### Password
- **Use:** `test123456` (minimum 8 characters)
- **Or:** Any password you prefer (min 8 chars)

### Seed Phrase
- **Save:** The 12-word phrase generated when creating wallet
- **Format:** 12 words separated by spaces
- **Example:** `abandon ability able about above absent absorb abstract abuse access accident account`

---

## 🔍 Browser Console Checks

### Open Browser Console
- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
- **Firefox:** Press `F12` or `Ctrl+Shift+K` (Windows) / `Cmd+Option+K` (Mac)
- **Safari:** Enable Developer menu first, then `Cmd+Option+C`

### What to Check

1. **No Red Errors:**
   - Should see no red error messages
   - Warnings (yellow) are usually OK

2. **API Calls:**
   - Should see successful API calls to:
     - `https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query`
     - `https://participant.dev.canton.wolfedgelabs.com/json-api/v1/create`
     - `https://participant.dev.canton.wolfedgelabs.com/json-api/v1/exercise`

3. **Network Tab:**
   - Check Network tab for failed requests
   - Status codes should be 200 (OK) or 201 (Created)
   - 404 or 500 errors indicate problems

---

## ⚠️ Common Issues & Solutions

### Issue: "Order book not found"

**Solution:**
- OrderBook contract needs to be created first
- Contact operator or create via API:
  ```bash
  curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/create \
    -H "Content-Type: application/json" \
    -d '{
      "templateId": "OrderBook:OrderBook",
      "payload": {
        "tradingPair": "BTC/USDT",
        "buyOrders": [],
        "sellOrders": [],
        "lastPrice": null,
        "operator": "YOUR_OPERATOR_PARTY_ID"
      },
      "actAs": ["YOUR_OPERATOR_PARTY_ID"]
    }'
  ```

### Issue: "Failed to fetch" or CORS errors

**Solution:**
1. Check API endpoint in browser console
2. Verify URL: `https://participant.dev.canton.wolfedgelabs.com/json-api`
3. Check network connectivity
4. Verify Canton node is accessible

### Issue: Balance shows 0.0

**Solution:**
- This is normal if UserAccount contract doesn't exist yet
- UserAccount will be created automatically when first order is placed
- Or create manually via API

### Issue: Orders not appearing

**Solution:**
1. Check browser console for errors
2. Verify OrderBook exists for the trading pair
3. Check that order was actually created (check API response)
4. Refresh page (order book auto-refreshes every 5 seconds)

---

## ✅ Success Criteria

### Must Have (Critical)
- ✅ Wallet can be created
- ✅ Wallet can be imported
- ✅ Orders can be placed (buy and sell)
- ✅ Orders can be cancelled
- ✅ Order book displays correctly
- ✅ My Orders displays correctly
- ✅ No console errors during normal usage

### Should Have (Important)
- ✅ Error messages for invalid inputs
- ✅ Loading states during API calls
- ✅ Success messages after actions
- ✅ Balance display works
- ✅ Multiple trading pairs work
- ✅ Auto-refresh works (every 5 seconds)

---

## 📸 Screenshots to Take

1. **Wallet Creation:**
   - Seed phrase displayed
   - Party ID shown

2. **Order Placement:**
   - Order form filled out
   - Success message

3. **Order Book:**
   - Buy orders visible
   - Sell orders visible
   - Correct sorting

4. **My Orders:**
   - List of orders
   - Status displayed

5. **Browser Console:**
   - No errors
   - Successful API calls

---

## 🎬 Demo Video Checklist

Record a 5-7 minute video showing:

1. [ ] Creating wallet (0:30)
2. [ ] Placing buy order (1:00)
3. [ ] Placing sell order (1:00)
4. [ ] Viewing order book (0:30)
5. [ ] Viewing my orders (0:30)
6. [ ] Cancelling order (0:30)
7. [ ] Checking balances (0:30)
8. [ ] Overall impression (0:30)

---

## 📞 Support

**If something doesn't work:**

1. **Check Browser Console** (F12 → Console tab)
2. **Check Network Tab** (F12 → Network tab)
3. **Take Screenshot** of error
4. **Copy Error Message** from console
5. **Report Issue** with:
   - What you did
   - What you expected
   - What actually happened
   - Screenshot
   - Console logs

---

**Status:** ✅ Ready for Testing  
**Last Updated:** December 31, 2024



