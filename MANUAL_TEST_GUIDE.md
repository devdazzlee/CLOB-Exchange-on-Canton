# Manual Testing Guide - CLOB Exchange

**Client**: Zoya Muhammad
**Party ID**: `8100b2db-86cf-40a1-8351-55483c151cdc`
**Test Date**: 2026-01-22

This guide provides **step-by-step instructions** to test all Milestone 1-3 features.

---

## Prerequisites

1. **Install dependencies**:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. **Configure backend** (.env already updated with your credentials)

3. **Build DAML contracts** (already done):
   ```bash
   ✅ File exists: daml/.daml/dist/clob-exchange-splice-1.0.0.dar
   ```

---

## Part 1: Deploy Contracts to Canton

**⚠️ IMPORTANT**: This step requires uploading the DAR to Canton.

### Option A: Using Canton Wallet (Recommended)

1. Go to: https://wallet.validator.dev.canton.wolfedgelabs.com/
2. Log in with your account (Zoya)
3. Navigate to "Developer" or "Admin" section
4. Look for "Upload Package" or "Upload DAR"
5. Upload: `daml/.daml/dist/clob-exchange-splice-1.0.0.dar`

### Option B: Contact Canton Admin

If you don't have admin access, contact WolfEdgeLabs support to upload the DAR file.

### Verify Upload

After uploading, run this to verify packages are installed:

```bash
# This should list your uploaded packages
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://65.108.40.104:31539/v2/packages
```

---

## Part 2: Start Backend & Create Orderbooks

### Step 1: Start Backend

```bash
cd backend
npm start
```

**Expected Output**:
```
╔═══════════════════════════════════════╗
║   CLOB Exchange Backend Server         ║
╚═══════════════════════════════════════╝

✓ Server running on port 3001
✓ WebSocket server available at ws://localhost:3001/ws

🤖 Starting Matching Engine...
✓ Matching Engine started successfully
  Polling interval: 2000ms
```

### Step 2: Create Global Orderbooks

Open a **new terminal** and run:

```bash
# Create BTC/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT

# Create ETH/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/ETH%2FUSDT

# Create SOL/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/SOL%2FUSDT
```

**Expected Response** (for each):
```json
{
  "success": true,
  "message": "OrderBook created successfully",
  "data": {
    "contractId": "00abc123...",
    "masterOrderBookContractId": "00def456...",
    "tradingPair": "BTC/USDT"
  }
}
```

### Step 3: Verify Orderbooks

```bash
curl http://localhost:3001/api/orderbooks
```

Should show all 3 orderbooks with 0 orders.

---

## Part 3: Test Milestone 1 (Wallet & Onboarding)

### Test 1.1: Create New Wallet

1. Open a **new terminal**, start frontend:
   ```bash
   cd frontend
   npm run dev
   ```

2. Open browser: `http://localhost:5173`

3. You should see **Wallet Setup** screen

4. Click **"Create New Wallet"**

5. **Mnemonic Display**:
   - ✅ Check: 12 words displayed in grid
   - ✅ Check: Warning message about saving phrase
   - 📝 **SAVE THESE 12 WORDS** (you'll need them for import test)

6. **Set Password**:
   - Enter password (min 8 characters)
   - Confirm password
   - Click **"Confirm & Create Wallet"**

7. **Onboarding Process** (2-step):
   - Watch console logs
   - Step 1: "Generating topology..."
   - Wallet unlocked (you have private key)
   - Step 2: "Allocating party..."
   - Should complete in ~5 seconds

8. **Wallet Ready Screen**:
   - ✅ Check: Green checkmark displayed
   - ✅ Check: Party ID shown (starts with `8100b2db-86cf...`)
   - ✅ Check: "Go to Trading Interface" button visible
   - 📝 **COPY YOUR PARTY ID** (for reference)

**✅ Milestone 1.1 Complete** if all checks pass.

### Test 1.2: Import Existing Wallet

1. Open **incognito/private window**

2. Go to: `http://localhost:5173`

3. Scroll down to **"Import Existing Wallet"**

4. Enter the **12-word mnemonic** you saved earlier

5. Enter a password (can be different)

6. Click **"Import Wallet"**

7. **Verify**:
   - ✅ Check: Onboarding completes
   - ✅ Check: **Same Party ID** as before
   - ✅ Check: Wallet ready screen shows

**✅ Milestone 1.2 Complete** if party ID matches.

### Test 1.3: Session Unlock (Just-in-Time)

1. Close browser completely

2. Reopen: `http://localhost:5173`

3. **Expected**:
   - Wallet found in localStorage
   - Party ID not stored OR needs re-registration
   - **Unlock modal should appear** when signature needed
   - ✅ Check: Not blocked from accessing dashboard

4. Enter your password

5. **Verify**:
   - ✅ Check: Wallet unlocks
   - ✅ Check: Onboarding completes
   - ✅ Check: No hard blocker before unlock

**✅ Milestone 1.3 Complete** if just-in-time unlock works.

---

## Part 4: Test Milestone 2 (Matching Engine)

### Test 2.1: Matching Engine Running

1. Check backend logs for:
   ```
   ✓ Matching Engine started successfully
   [MatchingEngine] Processing order book: BTC/USDT
   ```

2. Verify it polls every 2 seconds

**✅ Milestone 2.1 Complete** if logs show matching engine active.

### Test 2.2: Place Limit Order (User 1)

1. In **first browser** (User 1):
   - Click **"Go to Trading Interface"**
   - Select **BTC/USDT** from dropdown
   - Enter:
     - **Price**: 50000
     - **Quantity**: 0.1
   - Click **"Place Buy Order"** (green button)

2. **Verify**:
   - ✅ Check: Order appears in **"My Open Orders"** table
   - ✅ Check: Order shows in **orderbook** (green/bids side)
   - ✅ Check: Status shows "Open" or "Unfilled"

**✅ Milestone 2.2 Complete** if order appears.

### Test 2.3: Match Orders (User 2)

1. In **incognito window** (User 2):
   - Create new wallet OR import different wallet
   - Go to trading interface
   - Select **BTC/USDT**

2. Place **Sell Order**:
   - **Price**: 50000 (or lower, e.g., 49999)
   - **Quantity**: 0.1
   - Click **"Place Sell Order"** (red button)

3. **Wait 2-4 seconds** (matching engine polling interval)

4. **Verify Auto-Match**:
   - ✅ Check: Both orders **disappear** from orderbook
   - ✅ Check: New trade appears in **"Recent Trades"**
   - ✅ Check: Trade shows:
     - Price: ~50000
     - Amount: 0.1
     - Buyer/Seller party IDs
   - ✅ Check: Both users see trade in history

**✅ Milestone 2.3 Complete** if orders matched automatically.

### Test 2.4: Partial Fill

1. User 1 places buy order:
   - Price: 51000
   - Quantity: **1.0** BTC

2. User 2 places sell order:
   - Price: 51000
   - Quantity: **0.3** BTC (smaller)

3. **Verify**:
   - ✅ Check: Trade executes for **0.3 BTC**
   - ✅ Check: User 1's order shows **"Filled: 30%"**
   - ✅ Check: Remaining **0.7 BTC** still in orderbook
   - ✅ Check: User 2's order **fully filled** and removed

**✅ Milestone 2.4 Complete** if partial fill works correctly.

### Test 2.5: Order Cancellation

1. User 1 places order (any price/quantity)

2. In "My Open Orders" table, click **"Cancel"** button

3. **Verify**:
   - ✅ Check: Order immediately removed from table
   - ✅ Check: Order removed from orderbook
   - ✅ Check: Balance updated (funds returned)
   - ✅ Check: Order appears in **"Order History"** as cancelled

**✅ Milestone 2.5 Complete** if cancellation works instantly.

### Test 2.6: Self-Trade Prevention

1. In **same browser** (User 1):
   - Place buy order: Price 52000, Qty 0.1
   - Place sell order: Price 52000, Qty 0.1

2. **Verify**:
   - ✅ Check: Orders **do NOT match** with each other
   - ✅ Check: Both orders remain in orderbook
   - ✅ Check: Backend logs show: "Self-trade prevented" (if logging enabled)

**✅ Milestone 2.6 Complete** if self-trades blocked.

---

## Part 5: Test Milestone 3 (Professional UI)

### Test 3.1: Visual Order Book

With orders in the system, verify:

1. **Orderbook Display**:
   - ✅ Check: **Bids (green)** on left side
   - ✅ Check: **Asks (red)** on right side
   - ✅ Check: Prices aggregated by level
   - ✅ Check: Quantities shown for each price

2. **Spread Display**:
   - ✅ Check: Spread shown between best bid and best ask
   - Example: "Spread: 100 (0.2%)"

**✅ Milestone 3.1 Complete** if orderbook looks professional.

### Test 3.2: Depth Chart

1. Look for **depth chart** component (usually below orderbook)

2. **Verify**:
   - ✅ Check: Volume bars visible
   - ✅ Check: Longer bars = more liquidity
   - ✅ Check: Green bars for bids, red for asks

**✅ Milestone 3.2 Complete** if depth visualization works.

### Test 3.3: Real-Time WebSocket Updates

1. Open **browser console** (F12 → Console tab)

2. Place an order

3. **Check console logs**:
   ```
   WebSocket connected
   Subscribed to orderbook:BTC/USDT
   Update received: { type: "UPDATE", ... }
   ```

4. **Verify**:
   - ✅ Check: Orderbook updates **without page refresh**
   - ✅ Check: New orders appear instantly
   - ✅ Check: Trades appear in ticker immediately

**✅ Milestone 3.3 Complete** if real-time updates work.

### Test 3.4: Trade Ticker

1. Execute a few trades (match orders)

2. Look at **"Recent Trades"** or **"Global Trades"** section

3. **Verify**:
   - ✅ Check: Shows last 10-20 trades
   - ✅ Check: Each trade shows: Price, Amount, Time
   - ✅ Check: Newest trades appear at top
   - ✅ Check: Auto-scrolls or updates live

**✅ Milestone 3.4 Complete** if ticker shows trades.

### Test 3.5: Balance Sync

1. Note current balance

2. Place an order (locks funds)

3. **Verify**:
   - ✅ Check: Balance **instantly** shows locked amount
   - ✅ Check: "Available" balance reduced
   - ✅ Check: No page refresh needed

4. Cancel order

5. **Verify**:
   - ✅ Check: Balance **instantly** restored
   - ✅ Check: "Available" balance increased

**✅ Milestone 3.5 Complete** if balance syncs in real-time.

### Test 3.6: My Open Orders Table

1. Place 2-3 orders

2. Check **"My Open Orders"** table

3. **Verify**:
   - ✅ Check: All orders listed
   - ✅ Check: Shows: Type, Price, Quantity, Status
   - ✅ Check: Cancel button next to each
   - ✅ Check: Partial fill shows **"Filled: X%"**

**✅ Milestone 3.6 Complete** if table displays correctly.

### Test 3.7: Order History

1. Complete some trades and cancel some orders

2. Click **"Order History"** or **"Transaction History"** tab

3. **Verify**:
   - ✅ Check: Past orders shown
   - ✅ Check: Status: Completed, Cancelled, Partially Filled
   - ✅ Check: Timestamp for each

**✅ Milestone 3.7 Complete** if history displays.

### Test 3.8: Multiple Trading Pairs

1. Click **trading pair dropdown** (top of interface)

2. Select **ETH/USDT**

3. **Verify**:
   - ✅ Check: Orderbook **refreshes** to show ETH orders
   - ✅ Check: Input forms update to ETH
   - ✅ Check: Trade history shows ETH trades
   - ✅ Check: Context switches correctly

4. Switch back to **BTC/USDT**

5. **Verify**:
   - ✅ Check: Previous BTC orders still visible

**✅ Milestone 3.8 Complete** if pair switching works.

### Test 3.9: Responsive UI

1. Resize browser window

2. **Verify**:
   - ✅ Check: UI adapts to screen size
   - ✅ Check: Mobile-friendly layout (if applicable)
   - ✅ Check: No horizontal scrolling

**✅ Milestone 3.9 Complete** if responsive.

---

## Part 6: Performance Tests

### Test P.1: Matching Engine Performance

1. Place **10 orders** (5 buys, 5 sells) with overlapping prices

2. **Measure**:
   - Time until all matches execute
   - Should be < 5 seconds (2-second polling + execution)

3. **Verify**:
   - ✅ Check: All matches execute within 10 seconds
   - ✅ Check: No duplicate matches
   - ✅ Check: Correct FIFO order

**✅ Performance P.1 Complete** if fast matching.

### Test P.2: WebSocket Latency

1. Place order in one browser

2. **Measure** time until:
   - Other browser shows update
   - Should be < 500ms

3. **Verify**:
   - ✅ Check: Updates appear within 1 second

**✅ Performance P.2 Complete** if low latency.

---

## Part 7: Edge Cases

### Test E.1: Empty Orderbook

1. Cancel all orders

2. **Verify**:
   - ✅ Check: UI shows "No orders" message
   - ✅ Check: Spread shows "N/A"
   - ✅ Check: Depth chart empty

**✅ Edge Case E.1 Complete**.

### Test E.2: Large Order Size

1. Place order with **1000 BTC** (large quantity)

2. **Verify**:
   - ✅ Check: Order accepted
   - ✅ Check: Displays correctly in UI
   - ✅ Check: No overflow errors

**✅ Edge Case E.2 Complete**.

### Test E.3: Rapid Order Placement

1. Quickly place **5 orders** in succession

2. **Verify**:
   - ✅ Check: All orders processed
   - ✅ Check: No duplicate API calls (useRef guard works)
   - ✅ Check: All appear in orderbook

**✅ Edge Case E.3 Complete**.

---

## Test Results Checklist

### Milestone 1: Foundation & Wallet

- [ ] 1.1 Create wallet (Ed25519 keys)
- [ ] 1.2 Encrypt private key
- [ ] 1.3 Display mnemonic backup
- [ ] 1.4 Session unlock (just-in-time)
- [ ] 1.5 Import wallet
- [ ] 1.6 Canton API connectivity
- [ ] 1.7 Party ID display
- [ ] 1.8 Balance dashboard

**Milestone 1 Score**: ___/8

### Milestone 2: Matching Engine

- [ ] 2.1 Matching engine running
- [ ] 2.2 Place limit order
- [ ] 2.3 Auto-match orders
- [ ] 2.4 Partial fills
- [ ] 2.5 Order cancellation
- [ ] 2.6 Self-trade prevention

**Milestone 2 Score**: ___/6

### Milestone 3: Professional UI

- [ ] 3.1 Visual orderbook (bids/asks)
- [ ] 3.2 Depth chart
- [ ] 3.3 Real-time WebSocket
- [ ] 3.4 Trade ticker
- [ ] 3.5 Balance sync
- [ ] 3.6 My open orders table
- [ ] 3.7 Order history
- [ ] 3.8 Multiple trading pairs
- [ ] 3.9 Responsive UI

**Milestone 3 Score**: ___/9

### Performance Tests

- [ ] P.1 Matching speed (< 10 sec)
- [ ] P.2 WebSocket latency (< 1 sec)

**Performance Score**: ___/2

### Edge Cases

- [ ] E.1 Empty orderbook
- [ ] E.2 Large order size
- [ ] E.3 Rapid placement

**Edge Cases Score**: ___/3

---

## Overall Test Result

**Total Score**: ___/28

**Status**:
- ✅ **PASS** if score >= 25/28 (89%)
- ⚠️  **PARTIAL** if score 20-24/28 (71-86%)
- ❌ **FAIL** if score < 20/28 (< 71%)

---

## Issues Found

| Issue # | Description | Severity | Status |
|---------|-------------|----------|--------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## Sign-Off

**Tester Name**: ______________________
**Date**: ______________________
**Signature**: ______________________

**Result**: ☐ APPROVED  ☐ NEEDS FIXES  ☐ REJECTED

---

## Next Steps After Testing

If all tests pass:

1. ✅ Deploy to production Canton network
2. ✅ Set up monitoring (logs, alerts)
3. ✅ Configure rate limiting
4. ✅ Add SSL/HTTPS
5. ✅ Set up backup/recovery
6. ✅ Create user documentation

**Congratulations! Your CLOB Exchange is production-ready!** 🎉
