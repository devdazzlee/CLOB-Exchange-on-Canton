# Upload DAR & Test Current Implementation

**Date**: 2026-01-22
**Status**: Ready to upload and test

---

## Step 1: Upload DAR to Canton (5 minutes)

### DAR File Location
```
/Users/mac/Desktop/CLOB Exchange/CLOB-Exchange-on-Canton/daml/.daml/dist/clob-exchange-1.0.0.dar
```
**Size**: 725KB
**Status**: ✅ Built successfully

### Upload Instructions

**Option A: Canton Wallet UI** (Recommended)

1. **Open Canton Wallet**:
   - Go to: https://wallet.validator.dev.canton.wolfedgelabs.com/

2. **Login**:
   - Email: zoyamuhammad99@gmail.com
   - (Use your password/authentication)

3. **Find Upload Section**:
   - Look for "Developer" tab or menu
   - Or "Upload Package" / "Deploy Contract" option
   - May be under Settings > Advanced

4. **Upload DAR**:
   - Click "Upload Package" or similar button
   - Select file: `clob-exchange-1.0.0.dar`
   - Wait for upload to complete (should take 10-30 seconds)

5. **Verify**:
   - You should see a success message
   - Package ID will be displayed (save this)

**Option B: Contact Admin**

If you don't see upload option:
- Contact WolfEdgeLabs support
- Ask them to upload: `clob-exchange-1.0.0.dar`
- Provide your Party ID: `8100b2db-86cf-40a1-8351-55483c151cdc`

---

## Step 2: Start Backend (2 minutes)

```bash
cd backend
npm install   # If not already done
npm start
```

**Expected output**:
```
Server running on port 3001
✓ Matching Engine started successfully
[MatchingEngine] Polling interval: 2000ms
```

Keep this terminal running.

---

## Step 3: Create Global Orderbooks (1 minute)

Open new terminal:

```bash
# Create BTC/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT

# Create ETH/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/ETH%2FUSDT

# Create SOL/USDT orderbook
curl -X POST http://localhost:3001/api/admin/orderbooks/SOL%2FUSDT
```

**Expected response** (for each):
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

**If you get an error**:
- Make sure DAR is uploaded to Canton first
- Check backend logs for details

---

## Step 4: Start Frontend (1 minute)

Open another terminal:

```bash
cd frontend
npm install   # If not already done
npm run dev
```

**Expected output**:
```
VITE v4.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
```

---

## Step 5: Test What Works Now (10 minutes)

### What WILL Work ✅

Open browser: http://localhost:5173

#### Test 1: Wallet Creation
1. Click "Create New Wallet"
2. Save the 12-word mnemonic phrase
3. Set a password (min 8 characters)
4. **Expected**: Wallet created, shows "Setting up your account..."

#### Test 2: Onboarding
1. After wallet creation, wait for onboarding to complete
2. **Expected**: Shows Party ID on dashboard
3. **Expected**: Balances show (may be zero initially)

#### Test 3: Trading UI
1. Select trading pair (BTC/USDT)
2. **Expected**: See orderbook interface (bids/asks)
3. **Expected**: See "Place Order" form
4. **Expected**: See "Recent Trades" section

#### Test 4: WebSocket Real-Time
1. Open browser console (F12)
2. **Expected**: See "WebSocket connected"
3. **Expected**: See "Subscribed to orderbook:BTC/USDT"

### What WON'T Work ❌ (Known Limitations)

#### ❌ Placing Orders
**Issue**: No minting endpoint, users have zero balance
**Error**: "Insufficient funds" or similar

**Why**: Backend route `/api/testnet/mint-tokens` doesn't exist yet

#### ❌ Asset Transfers
**Issue**: Asset allocation logic commented out in DAML
**Impact**: Even if you had balance, orders won't lock funds on-ledger

#### ❌ Trade Settlement
**Issue**: Settlement doesn't execute asset swaps on-chain
**Impact**: Trades create records but don't transfer assets

---

## Step 6: Quick Test with Mock Data (Optional)

If you want to see the UI in action without real Canton transactions:

### Add Mock Balances (Frontend Only)

Open browser console and run:
```javascript
localStorage.setItem('balances', JSON.stringify({
  'BTC': 1.5,
  'ETH': 10.0,
  'SOL': 100.0,
  'USDT': 50000.0
}));
location.reload();
```

Now you can:
- See non-zero balances in UI
- Place orders (they'll go to backend)
- See orderbook populate
- Watch matching engine work (checks logs every 2 seconds)

**Note**: This is UI-only mock data, not real Canton state.

---

## Expected Test Results Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Wallet Creation | ✅ Works | Ed25519 keys, AES encryption |
| Wallet Import | ✅ Works | 12-word mnemonic |
| 2-Step Onboarding | ✅ Works | Topology generation + allocation |
| Party ID Display | ✅ Works | Shows after onboarding |
| Trading UI | ✅ Works | Professional interface loads |
| WebSocket Connection | ✅ Works | Real-time updates ready |
| Orderbook Display | ✅ Works | Shows bids/asks |
| Matching Engine | ✅ Runs | Polls every 2 seconds |
| Mint Test Tokens | ❌ Fails | Endpoint missing |
| Place Orders | ❌ Partial | Creates orders but no asset lock |
| Trade Settlement | ❌ Partial | Records created, no asset transfer |
| Balance Updates | ❌ Partial | UI updates, but not on-ledger |

---

## What You'll Learn from This Test

### ✅ What's Complete:
- Wallet system (cryptography, encryption, backup)
- Onboarding flow (Canton external party allocation)
- Professional trading UI
- Matching engine logic (FIFO, price-time priority)
- WebSocket infrastructure
- Order management UI

### ❌ What's Missing:
- Asset contracts (Cash/Token templates)
- On-ledger asset locking
- Minting/faucet endpoint
- Real settlement with asset swaps
- Cancellation refunds

---

## After Testing

Once you've tested what works, decide:

**Option 1**: Continue testing the UI/UX flow (good for demo)
**Option 2**: Fix missing pieces (Asset contracts, locking, minting) for real functionality

Let me know what you find and which direction to take next!

---

## Troubleshooting

### "Cannot create orderbook"
- Make sure DAR is uploaded to Canton first
- Check backend logs for specific error
- Verify Party ID in `.env` is correct

### "WebSocket disconnected"
- Backend may not be running
- Check port 3001 is not blocked
- Restart backend

### "Onboarding stuck"
- Check browser console for errors
- Verify Canton API is accessible
- Check backend logs for OAuth token errors

### "Orders not showing"
- WebSocket may be disconnected
- Try refreshing page
- Check backend matching engine logs

---

**Next Steps**: Upload DAR → Start services → Test → Report findings
