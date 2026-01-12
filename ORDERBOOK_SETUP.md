# OrderBook Setup Guide

## Overview

OrderBooks are **global** (shared by all users) and must be created by an **operator/admin** before users can trade. Each trading pair requires its own OrderBook.

## OrderBooks Created for Testing

The following OrderBooks should be created for testing:

1. **BTC/USDT** - Bitcoin/Tether
2. **ETH/USDT** - Ethereum/Tether  
3. **SOL/USDT** - Solana/Tether

## How to Create OrderBooks

### Option 1: Using Helper Script (Easiest)

```bash
# Make sure backend is running on http://localhost:3001
./scripts/create-orderbooks.sh
```

This will create OrderBooks for:
- BTC/USDT
- ETH/USDT
- SOL/USDT

### Option 2: Using Admin API Endpoint

Create a single OrderBook:
```bash
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT
```

Create multiple OrderBooks at once:
```bash
curl -X POST http://localhost:3001/api/admin/orderbooks \
  -H "Content-Type: application/json" \
  -d '{
    "tradingPairs": ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
  }'
```

### Option 3: Using Node Script (Requires JWT Token)

```bash
# Set the operator's JWT token
export CANTON_JWT_TOKEN="your_operator_jwt_token"

# Run the script
node scripts/create-orderbook.js [operator-party-id]
```

## Verify OrderBooks Exist

Check all OrderBooks:
```bash
curl http://localhost:3001/api/orderbooks
```

Check a specific OrderBook:
```bash
curl http://localhost:3001/api/orderbooks/BTC%2FUSDT
```

## Important Notes

### UTXO Model Consideration

**⚠️ Important**: Canton operates on a UTXO (Unspent Transaction Output) model. This means:

- When a user places an order, funds are locked in a UTXO
- If a user cancels an order, the UTXO is released but may remain separate
- **Users might not be able to place larger orders** after canceling unless UTXOs are merged

**Example Scenario:**
1. User has 100 CC (Canton Coin)
2. User places order for 50 CC → UTXO of 50 CC is locked
3. User cancels order → UTXO of 50 CC is released
4. User tries to place order for 51 CC → **May fail** because UTXOs aren't merged (50 CC + remaining balance might not combine)

**Current Status**: The UserAccount contract uses a simple Map-based balance system, not UTXO-based. However, when orders are placed, the actual token transfers might create UTXOs that need merging.

**Future Enhancement Needed**: Add UTXO merging functionality to handle canceled orders properly.

## Troubleshooting

### Error: "OrderBook not found"

This means the OrderBook hasn't been created yet. Use one of the methods above to create it.

### Error: "OrderBook already exists"

The OrderBook already exists. Use `GET /api/orderbooks/:tradingPair` to retrieve it.

### Empty OrderBook

An empty OrderBook is normal when first created. Orders will appear as users place them.

## Testing OrderBooks

After creating OrderBooks, you can:

1. **View OrderBooks** in the frontend trading interface
2. **Place orders** - they will appear in the OrderBook
3. **Match orders** - buy and sell orders will match automatically
4. **Cancel orders** - orders can be cancelled (note UTXO considerations above)

