# 🚨 URGENT: Create OrderBooks Now

## Current Status

**OrderBooks have NOT been created yet!** The order books are empty because they haven't been created on the ledger.

## What Needs to Be Done

Create the following OrderBooks for testing:
1. **BTC/USDT** - Bitcoin/Tether
2. **ETH/USDT** - Ethereum/Tether  
3. **SOL/USDT** - Solana/Tether

## Quick Fix: Run the Script

### Step 1: Get Your Token

You need a JWT token with permissions to create contracts. You can use:

**Option A: User OAuth Token (Recommended - Huzefa's approach)**
- Get your OAuth token from Keycloak (already has actAs/readAs claims)
- Copy the token from your browser's localStorage or network tab
- Look for: `keycloak_access_token` or `canton_jwt_token` in localStorage

**Option B: Operator Token**
- Login to Keycloak: `https://keycloak.wolfedgelabs.com:8443`
- Realm: `canton-devnet`
- Get token for operator account

### Step 2: Set Environment Variable

```bash
# Windows (PowerShell)
$env:CANTON_JWT_TOKEN="your_token_here"

# Windows (CMD)
set CANTON_JWT_TOKEN=your_token_here

# Mac/Linux
export CANTON_JWT_TOKEN="your_token_here"
```

### Step 3: Run the Script

```bash
# Uses default operator party ID
node scripts/create-orderbook.js

# OR specify operator party ID if different
node scripts/create-orderbook.js "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"
```

### Step 4: Verify Creation

You should see output like:
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
🎉 OrderBooks are ready! You can now place orders in the frontend.
```

## Expected Results After Creation

After running the script:
- ✅ OrderBooks will exist on the ledger
- ✅ Users will see empty OrderBooks (no orders yet, but OrderBooks exist)
- ✅ Users can place orders which will populate the OrderBooks
- ✅ All users will see the same global OrderBooks (not per-user)

## Troubleshooting

### Error: "CANTON_JWT_TOKEN not set"
- Make sure you set the environment variable (see Step 2)
- Check that the token is not expired

### Error: "Failed to create contract"
- Check that your token has actAs claims for the operator party
- Verify the token is valid (not expired)
- Check that you have permissions to create contracts

### Error: "Party not found"
- Verify the operator party ID is correct
- Make sure the operator party exists on the ledger

## After Creating OrderBooks

Once OrderBooks are created:
1. Users can see them in the frontend (they'll be empty initially)
2. Users can place buy/sell orders
3. Orders will appear in the OrderBook
4. All users share the same global OrderBooks

## Note About Empty OrderBooks

**Empty OrderBooks are normal!** OrderBooks start empty and get populated as users place orders. The important thing is that the OrderBook **contracts exist** on the ledger, not that they have orders in them.

An empty OrderBook means:
- ✅ OrderBook contract exists (good!)
- ✅ No orders yet (normal - users need to place orders)

A missing OrderBook means:
- ❌ OrderBook contract doesn't exist (needs to be created)
- ❌ Users see "OrderBook not found" error
- ❌ Users cannot place orders

