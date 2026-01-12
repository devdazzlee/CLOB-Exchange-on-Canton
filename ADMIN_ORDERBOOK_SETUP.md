# Admin OrderBook Setup Guide

## Issue Summary

When a fresh wallet logs in from a new browser, the order book appears empty because **OrderBooks must be created by an admin/operator before users can place orders**. OrderBooks are global contracts shared across all users on the ledger.

## Order Books Required for Testing

Based on the test configuration, the following OrderBooks should be created:

### Required Trading Pairs:
1. **BTC/USDT** (Bitcoin/Tether)
2. **ETH/USDT** (Ethereum/Tether)  
3. **SOL/USDT** (Solana/Tether)

These are defined in `scripts/create-orderbook.js` as the default trading pairs.

## How to Create OrderBooks

### Prerequisites

1. **JWT Token**: You need a Canton JWT token with operator/admin permissions
   ```bash
   export CANTON_JWT_TOKEN="your_jwt_token_here"
   ```

2. **Operator Party ID**: The party ID of the operator/admin account
   - Default in script: `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`
   - **Important**: Update this with your actual operator party ID

### Method 1: Using the Create OrderBook Script (Recommended)

Run the Node.js script that creates all required OrderBooks:

```bash
# Set your JWT token
export CANTON_JWT_TOKEN="your_jwt_token_here"

# Run the script (uses default operator party ID)
node scripts/create-orderbook.js

# OR specify your operator party ID as an argument
node scripts/create-orderbook.js "your-operator-party-id"
```

**What the script does:**
- Creates OrderBooks for: BTC/USDT, ETH/USDT, SOL/USDT
- Each OrderBook is initialized with:
  - Empty buy orders list: `[]`
  - Empty sell orders list: `[]`
  - No last price: `null`
  - Your operator party ID as the operator

**Expected Output:**
```
🌱 Creating OrderBook contracts...

Creating OrderBook for BTC/USDT...
✅ Created OrderBook for BTC/USDT
   Contract ID: 00abc123...

Creating OrderBook for ETH/USDT...
✅ Created OrderBook for ETH/USDT
   Contract ID: 00def456...

Creating OrderBook for SOL/USDT...
✅ Created OrderBook for SOL/USDT
   Contract ID: 00ghi789...

✅ OrderBook creation complete!

Summary:
  BTC/USDT: 00abc123...
  ETH/USDT: 00def456...
  SOL/USDT: 00ghi789...

🎉 OrderBooks are ready! You can now place orders in the frontend.
```

### Method 2: Manual Creation via API

If you prefer to create OrderBooks manually via the Canton JSON API:

```bash
curl -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/commands/submit-and-wait" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CANTON_JWT_TOKEN" \
  -d '{
    "commands": [
      {
        "CreateCommand": {
          "templateId": "OrderBook:OrderBook",
          "createArguments": {
            "tradingPair": "BTC/USDT",
            "buyOrders": [],
            "sellOrders": [],
            "lastPrice": null,
            "operator": "your-operator-party-id",
            "activeUsers": [],
            "userAccounts": {}
          }
        }
      }
    ],
    "commandId": "create-btc-usdt-orderbook-'$(date +%s)'",
    "actAs": ["your-operator-party-id"]
  }'
```

Repeat for ETH/USDT and SOL/USDT with the appropriate `tradingPair` value.

## Verification

After creating OrderBooks, verify they exist:

1. **Via Frontend**: 
   - Log in with a fresh wallet
   - Navigate to the Trading Interface
   - Select a trading pair (e.g., BTC/USDT)
   - The Order Book panel should show "Order Book - BTC/USDT" with empty buy/sell lists (not an error)
   - You should be able to place orders

2. **Via API**:
   ```bash
   curl -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/state/active-contracts" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CANTON_JWT_TOKEN" \
     -d '{
       "readAs": ["your-operator-party-id"],
       "activeAtOffset": "0",
       "verbose": false,
       "filter": {
         "filtersByParty": {
           "your-operator-party-id": {
             "inclusive": {
               "templateIds": ["OrderBook:OrderBook"]
             }
           }
         }
       }
     }'
   ```

## Important Notes

1. **OrderBooks are Global**: Once created, all users on the ledger can see and use the same OrderBook for each trading pair.

2. **One OrderBook Per Pair**: There should typically be only ONE OrderBook per trading pair. If multiple exist, the frontend will try to use the most recent one.

3. **Empty vs. Non-existent**: 
   - An **empty OrderBook** (created but with no orders) is fine - users can still place orders
   - A **non-existent OrderBook** (not created) will show an error and prevent order placement

4. **Operator Role**: The operator party specified during creation has special permissions to manage the OrderBook (though currently users can place orders through the OrderBook's `AddOrder` choice).

5. **Fresh Wallets**: When a user creates a fresh wallet and logs in from a new browser, they will see empty OrderBooks (no orders yet) but should NOT see "OrderBook not found" errors if the OrderBooks were created correctly.

## Troubleshooting

### Error: "orderBooks is not defined"
- **Status**: ✅ FIXED - This was a bug in TradingInterface.jsx where `orderBooks` was referenced outside its scope. Fixed in the latest code.

### Error: "OrderBook not found"
- **Cause**: OrderBooks haven't been created yet
- **Solution**: Run `node scripts/create-orderbook.js` with the correct operator party ID and JWT token

### Error: "CANTON_JWT_TOKEN environment variable not set"
- **Solution**: Export the token: `export CANTON_JWT_TOKEN="your_token"`

### OrderBooks exist but are empty
- **Status**: ✅ EXPECTED - Empty OrderBooks are normal. Users need to place orders to populate them.

### Cannot see OrderBooks from user account
- **Possible Causes**:
  1. OrderBooks may not be visible to all parties (authorization issue)
  2. The user's party may need to be added as an observer
  3. Check that OrderBooks were created with the correct operator party

## Testing Checklist

After creating OrderBooks, verify:

- [ ] BTC/USDT OrderBook created and visible
- [ ] ETH/USDT OrderBook created and visible  
- [ ] SOL/USDT OrderBook created and visible
- [ ] Fresh wallet can see OrderBook (not "not found" error)
- [ ] Can place buy orders
- [ ] Can place sell orders
- [ ] Orders appear in Order Book panel
- [ ] No "orderBooks is not defined" errors in browser console

## Related Files

- `scripts/create-orderbook.js` - Script to create OrderBooks
- `scripts/seed-demo-data.js` - Alternative script that also creates OrderBooks (but uses older API v1)
- `daml/OrderBook.daml` - DAML template definition for OrderBook contracts
- `frontend/src/components/TradingInterface.jsx` - Frontend code that queries OrderBooks

