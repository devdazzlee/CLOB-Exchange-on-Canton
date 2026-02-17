# CBTC Integration & Token Transfer Guide

## ✅ What Has Been Implemented

### 1. Token Model (Instruments + Holdings) ✅
- **Instrument.daml**: Defines token types (BTC, USDT, ETH, SOL, CBTC)
- **Holding.daml**: Actual token ownership (UTXO model)
- **Settlement.daml**: Atomic DvP (Delivery vs Payment) settlement

**Key Feature**: Holdings correctly transfer between parties on CLOB settlement!

### 2. Transfer Offer Service ✅
New API endpoints to accept tokens from Canton DevNet utilities:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/transfers/cbtc-instructions` | GET | Get step-by-step instructions |
| `/api/transfers/offers/:partyId` | GET | List pending transfer offers |
| `/api/transfers/accept` | POST | Accept a transfer offer |
| `/api/transfers/external-tokens` | GET | List available external tokens |

### 3. Settlement Flow (Holdings Transfer) ✅
When orders match:
1. ✅ Buyer's USDT Holding is LOCKED
2. ✅ Seller's BTC Holding is LOCKED
3. ✅ Matching engine creates `SettlementInstruction`
4. ✅ Operator executes `Settlement_Execute`:
   - Archives buyer's USDT Holding
   - Archives seller's BTC Holding
   - **Creates NEW BTC Holding for buyer** ← Transfer happens here!
   - **Creates NEW USDT Holding for seller** ← Transfer happens here!
   - Returns any excess as change Holdings
   - Creates Trade record

## 📋 What You Need To Do

### Step 1: Request CBTC from Faucet

1. **Go to Canton DevNet Utilities:**
   ```
   https://utilities.dev.canton.wolfedgelabs.com/
   ```

2. **Navigate to Registry → Transfers:**
   - In the utilities UI, find the "Registry" section
   - Click on "Transfers"

3. **Request CBTC for Your Party ID:**
   - Your operator party ID:
     ```
     8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292
     ```
   - You should see a **transfer-offer** of CBTC available to accept

### Step 2: Accept the Transfer Offer

**Option A: Via API (Recommended)**
```bash
# 1. Check for pending offers
curl "http://localhost:3001/api/transfers/offers/8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"

# 2. Accept the offer (replace <contract-id> with actual ID from step 1)
curl -X POST "http://localhost:3001/api/transfers/accept" \
  -H "Content-Type: application/json" \
  -d '{
    "offerContractId": "<contract-id-from-step-1>",
    "partyId": "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"
  }'
```

**Option B: Via Utilities UI**
- Click "Accept" on the transfer-offer in the utilities UI

### Step 3: Verify CBTC in Holdings

```bash
# Check your balance (should now include CBTC)
curl "http://localhost:3001/api/balance/8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"

# Or list all Holdings
curl "http://localhost:3001/api/balance/v2/holdings/8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"
```

## 🧪 Testing the Complete Flow

### Test 1: Verify Holdings Transfer on Settlement

```bash
# 1. Check current Holdings
curl "http://localhost:3001/api/balance/v2/holdings/external-wallet-user-b36d2fd43ba9ecfa::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292" | jq '[.data.holdings[] | select(.symbol == "BTC" or .symbol == "USDT")]'

# 2. Place a BUY order (locks USDT)
curl -X POST "http://localhost:3001/api/orders/place" \
  -H "Content-Type: application/json" \
  -d '{
    "partyId": "external-wallet-user-b36d2fd43ba9ecfa::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292",
    "tradingPair": "BTC/USDT",
    "orderType": "BUY",
    "orderMode": "LIMIT",
    "price": "50000",
    "quantity": "0.1"
  }'

# 3. Place a SELL order (locks BTC) from another user
# (Use a different party ID or the operator party)

# 4. Wait for matching engine to execute (runs every 2 seconds)

# 5. Verify Holdings transferred:
#    - Buyer should have NEW BTC Holding
#    - Seller should have NEW USDT Holding
#    - Old locked Holdings should be archived
curl "http://localhost:3001/api/balance/v2/holdings/external-wallet-user-b36d2fd43ba9ecfa::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292" | jq '[.data.holdings[] | select(.symbol == "BTC" or .symbol == "USDT")]'
```

### Test 2: Verify Transfer Offer API

```bash
# Get instructions
curl "http://localhost:3001/api/transfers/cbtc-instructions" | jq '.data.steps'

# Check for offers
curl "http://localhost:3001/api/transfers/offers/<your-party-id>"

# List external tokens
curl "http://localhost:3001/api/transfers/external-tokens"
```

## 📊 Current System Status

✅ **Working:**
- Token Standard (Instrument + Holding contracts)
- Order placement (locks Holdings)
- Balance display (from Holdings)
- Settlement (transfers Holdings atomically)
- Transfer offer API endpoints

🔴 **Waiting for Client:**
- Request CBTC from utilities faucet
- Accept transfer offer
- Verify CBTC appears in Holdings

## 🔍 How to Verify Holdings Transfer

After a trade executes, check:

1. **Buyer's Holdings:**
   ```bash
   curl "http://localhost:3001/api/balance/v2/holdings/<buyer-party-id>"
   ```
   - Should have NEW BTC Holding (amount = trade quantity)
   - Old USDT Holding should be archived (not in list)

2. **Seller's Holdings:**
   ```bash
   curl "http://localhost:3001/api/balance/v2/holdings/<seller-party-id>"
   ```
   - Should have NEW USDT Holding (amount = trade value)
   - Old BTC Holding should be archived (not in list)

3. **Trade Record:**
   ```bash
   curl "http://localhost:3001/api/trades/v2/BTC/USDT"
   ```
   - Should show the executed trade

## 🎯 Key Points

1. **Holdings Transfer is Atomic**: Settlement either completes fully or rolls back
2. **No Partial State**: Buyer and seller Holdings update together
3. **Change Handling**: Excess funds returned as separate Holdings
4. **CBTC Support**: Once accepted, CBTC can be traded like any other token

## 📝 Notes

- **Validator-App Credentials**: Current approach works for dev. Production will use limited-privilege user (client will handle).
- **Token Persistence**: All Holdings persist on Canton ledger (no in-memory storage).
- **CBTC**: Request from utilities faucet, then accept via API or UI.
