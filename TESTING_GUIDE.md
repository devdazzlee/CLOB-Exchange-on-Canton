# CLOB Exchange - Client Testing Guide

**Project:** CLOB Exchange on Canton Blockchain  
**Milestone:** Milestone 1 - Core Functionality  
**Delivery Date:** Friday, January 2, 2026  
**Testing Deadline:** Thursday, January 2, 2026, 9 PM

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Test Scenarios](#test-scenarios)
4. [Success Criteria](#success-criteria)
5. [Reporting Issues](#reporting-issues)
6. [Demo Video Checklist](#demo-video-checklist)

---

## Prerequisites

### Required Software
- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **Modern Web Browser** (Chrome, Firefox, Safari, or Edge)
- **Internet Connection** (for Canton devnet access)

### Access Information
- **Canton Node:** `participant.dev.canton.wolfedgelabs.com`
- **JSON API:** `https://participant.dev.canton.wolfedgelabs.com/json-api`
- **Keycloak Account:**
  - Username: `zoya`
  - Password: `Zoya123!`
- **Demo Wallet ID:** `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`

---

## Quick Start

### Step 1: Setup

```bash
# Clone or download the project
cd CLOB-Exchange-on-Canton

# Install dependencies
cd frontend
npm install

# Start development server
npm run dev
```

The application will open at: **http://localhost:3000**

### Step 2: Verify Connection

1. Open browser DevTools (F12)
2. Go to Console tab
3. Check for any red error messages
4. If you see "Connected to Canton" or no errors, you're ready!

---

## Test Scenarios

### Test 1: Wallet Creation ✅

**Objective:** Verify wallet can be created and seed phrase is generated

**Steps:**
1. Open application at http://localhost:3000
2. Click **"Create New Wallet"** button
3. Enter password: `test123` (or any secure password)
4. Click **"Generate Wallet"**
5. **IMPORTANT:** A 12-word seed phrase will appear
6. **SAVE THIS SEED PHRASE** - Write it down or copy it
7. Check the box: **"I have saved my seed phrase"**
8. Click **"Continue"**

**Expected Results:**
- ✅ 12-word seed phrase displayed
- ✅ Seed phrase is unique each time
- ✅ Wallet address displayed (starts with party ID)
- ✅ Address is copyable
- ✅ No error messages in console

**Screenshot Required:** Take screenshot showing seed phrase and address

---

### Test 2: Wallet Import ✅

**Objective:** Verify wallet can be imported using seed phrase

**Steps:**
1. Click **"Import Wallet"** (or refresh page and select import)
2. Enter the 12-word seed phrase from Test 1
3. Enter password: `test123` (same as used in Test 1)
4. Click **"Import Wallet"**

**Expected Results:**
- ✅ Same wallet address as Test 1 appears
- ✅ No error messages
- ✅ Successfully logged in

**Verification:** Compare the address with Test 1 - should be identical

---

### Test 3: Place Buy Order ✅

**Objective:** Verify buy orders can be placed successfully

**Steps:**
1. Navigate to **"Place Order"** tab (or click "Trading" in header)
2. Select trading pair: **BTC/USDT** from dropdown
3. Click **"BUY"** button (should turn green/active)
4. Enter Price: `42000`
5. Enter Quantity: `0.5`
6. Verify **Total** shows: `21000 USDT` (Price × Quantity)
7. Click **"Place Order"** button

**Expected Results:**
- ✅ Success message appears: "Order placed successfully"
- ✅ Order appears in **"Order Book"** under **BUY ORDERS** section
- ✅ Order appears in **"My Orders"** tab with status **"OPEN"**
- ✅ Order shows correct price, quantity, and total
- ✅ No error messages in console

**Screenshot Required:** Order book showing your buy order

---

### Test 4: Place Sell Order ✅

**Objective:** Verify sell orders can be placed successfully

**Steps:**
1. Go to **"Place Order"** tab
2. Select pair: **BTC/USDT**
3. Click **"SELL"** button (should turn red/active)
4. Enter Price: `43000`
5. Enter Quantity: `0.3`
6. Verify Total shows: `12900 USDT`
7. Click **"Place Order"**

**Expected Results:**
- ✅ Success message appears
- ✅ Order appears in **"Order Book"** under **SELL ORDERS** section
- ✅ Order appears in **"My Orders"** tab
- ✅ Sell orders sorted from **lowest to highest** price
- ✅ Buy orders sorted from **highest to lowest** price

**Verification:** Check order book - sell orders should be in ascending price order

---

### Test 5: Order Book Display ✅

**Objective:** Verify order book displays correctly

**Steps:**
1. Click **"Order Book"** tab
2. Observe the display

**Expected Results:**
- ✅ **BUY ORDERS** section shows in green (or distinct color)
- ✅ **SELL ORDERS** section shows in red (or distinct color)
- ✅ Buy orders sorted: **Highest price first** (42000, 41900, 41800...)
- ✅ Sell orders sorted: **Lowest price first** (42100, 42200, 42300...)
- ✅ Each order shows:
  - Price
  - Quantity (remaining quantity, not total)
  - Total (Price × Quantity)
- ✅ Orders update when new orders are placed

**Checklist:**
- [ ] Buy orders visible
- [ ] Sell orders visible
- [ ] Correct sorting
- [ ] Price displayed correctly
- [ ] Quantity displayed correctly
- [ ] Total calculated correctly

---

### Test 6: Cancel Order ✅

**Objective:** Verify orders can be cancelled

**Steps:**
1. Go to **"My Orders"** tab
2. Find an order with status **"OPEN"**
3. Click **"Cancel"** button next to the order
4. Confirm cancellation (if confirmation dialog appears)

**Expected Results:**
- ✅ Order disappears from **"My Orders"** list
- ✅ Order removed from **"Order Book"**
- ✅ Success message: "Order cancelled successfully"
- ✅ Order status changes to **"CANCELLED"** (if still visible)

**Verification:** Check order book - cancelled order should not appear

---

### Test 7: Balance Display ✅

**Objective:** Verify account balances are displayed

**Steps:**
1. Look at the **"Balance"** section (usually in header or sidebar)
2. Check displayed balances

**Expected Results:**
- ✅ **USDT** balance displayed (number, not NaN or undefined)
- ✅ **BTC** balance displayed
- ✅ **ETH** balance displayed (if applicable)
- ✅ Balances are numbers (can be 0.0)
- ✅ No error messages

**Note:** Initial balances may be 0.0 until deposits are made

---

### Test 8: Multiple Trading Pairs ✅

**Objective:** Verify different trading pairs work independently

**Steps:**
1. Place order for **BTC/USDT**
2. Switch trading pair to **ETH/USDT**
3. Place order for **ETH/USDT**
4. Switch back to **BTC/USDT**
5. Check order book for each pair

**Expected Results:**
- ✅ Order book shows correct orders for selected pair
- ✅ Orders don't mix between pairs
- ✅ **"My Orders"** shows orders from all pairs
- ✅ Can filter by pair in "My Orders" (if feature exists)

---

### Test 9: Error Handling ✅

**Objective:** Verify proper error messages for invalid inputs

#### Test 9A: Invalid Price
**Steps:**
1. Go to Place Order
2. Enter Price: `-100` (negative)
3. Try to place order

**Expected:** Error message "Price must be positive" or similar

#### Test 9B: Invalid Quantity
**Steps:**
1. Enter Quantity: `0` or negative number
2. Try to place order

**Expected:** Error message "Quantity must be greater than 0"

#### Test 9C: Empty Fields
**Steps:**
1. Leave Price or Quantity empty
2. Try to place order

**Expected:** Error message or fields highlighted in red

#### Test 9D: Wrong Password
**Steps:**
1. Try to unlock wallet with wrong password
2. Or try to import wallet with wrong password

**Expected:** Error message "Incorrect password" or "Invalid credentials"

---

### Test 10: Order Matching (Advanced) ✅

**Objective:** Verify orders can match when prices overlap

**Steps:**
1. Place **BUY** order at price: `42000`, quantity: `0.5`
2. Place **SELL** order at price: `41900`, quantity: `0.3`
3. Check if orders match (if matching is automatic)
4. Or trigger matching manually (if button exists)

**Expected Results:**
- ✅ Orders match if buy price >= sell price
- ✅ Trade record created (if visible)
- ✅ Orders updated (filled or removed)
- ✅ Balances updated (if applicable)

**Note:** This may require operator to trigger matching or may be automatic

---

## Success Criteria for Milestone 1

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

### Nice to Have (Optional)
- ✅ Order matching works
- ✅ Trade history visible
- ✅ Real-time updates
- ✅ Advanced filtering

---

## Reporting Issues

### Issue Report Template

```
**Issue Title:** [Brief description]

**Test Number:** [Which test failed]

**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happened]

**Screenshots:**
[Attach screenshots]

**Browser Console Logs:**
[Copy error messages from F12 → Console]

**Browser:** [Chrome/Firefox/Safari/Edge]
**Version:** [Browser version]
**OS:** [Windows/Mac/Linux]
```

### Example Issue Report

```
**Issue Title:** Order not appearing in order book

**Test Number:** Test 3

**Steps to Reproduce:**
1. Placed buy order for BTC/USDT at 42000, qty 0.5
2. Clicked "Place Order"
3. Got success message
4. Went to Order Book tab
5. Order not visible

**Expected Behavior:**
Order should appear in BUY ORDERS table

**Actual Behavior:**
Table is empty, no orders visible

**Screenshots:**
[attached: order-book-empty.png]

**Browser Console Logs:**
Error: Failed to query OrderBook contract
POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query 404

**Browser:** Chrome
**Version:** 120.0.6099.109
**OS:** macOS Sonoma
```

---

## Demo Video Checklist

Please record a **5-7 minute** video demonstrating:

### Introduction (0:30)
- [ ] Show application URL
- [ ] Explain what you're testing

### Wallet Creation (1:00)
- [ ] Create new wallet
- [ ] Show seed phrase (blur sensitive parts)
- [ ] Show wallet address

### Order Placement (2:00)
- [ ] Place buy order
- [ ] Place sell order
- [ ] Show order book with both orders

### Order Management (1:00)
- [ ] View "My Orders"
- [ ] Cancel an order
- [ ] Show order removed from book

### Balance & Summary (0:30)
- [ ] Show balances
- [ ] Overall impression

### Total Time: ~5 minutes

**Video Requirements:**
- Clear audio
- Good quality (720p minimum)
- Show browser console (F12) if errors occur
- Narrate what you're doing

---

## Advanced Testing

### Test DAML Contracts Directly

```bash
cd daml
daml test --all
```

**Expected:** All tests pass ✓

### Test Canton Connection

```bash
# Check if contracts are deployed
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["UserAccount:UserAccount"]}'
```

**Expected:** Returns list of contracts or empty array (not error)

### Upload DAR File

```bash
# Set JWT token (if required)
export JWT_TOKEN="your-token-here"

# Upload DAR
./scripts/upload-dar.sh
```

---

## Contact & Support

### During Testing
- **Upwork:** Message me on the platform
- **Email:** [Your email]
- **Response Time:** Within 4 hours during business hours

### Testing Timeline
- **Start Testing:** As soon as you receive this guide
- **Report Issues:** Within 24 hours of discovery
- **Complete Testing:** Thursday, January 2, 2026, 9 PM
- **Final Approval:** Friday, January 2, 2026

---

## Quick Reference

### Key URLs
- **Application:** http://localhost:3000
- **Canton JSON API:** https://participant.dev.canton.wolfedgelabs.com/json-api
- **Keycloak:** https://keycloak.wolfedgelabs.com:8443

### Test Accounts
- **Demo Wallet:** `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`
- **Keycloak:** Username `zoya`, Password `Zoya123!`

### Common Issues

**Issue:** "Cannot connect to Canton"
- **Solution:** Check internet connection, verify Canton node is accessible

**Issue:** "Order not appearing"
- **Solution:** Check browser console for errors, verify DAR is uploaded

**Issue:** "Wallet import fails"
- **Solution:** Verify seed phrase is correct, check for typos

---

## Final Checklist Before Approval

- [ ] All 10 test scenarios completed
- [ ] No critical bugs found
- [ ] Screenshots taken for each test
- [ ] Demo video recorded
- [ ] Issues reported (if any)
- [ ] Overall functionality verified
- [ ] Ready for production deployment

---

**Thank you for testing! Your feedback is valuable for improving the platform.** 🚀



