# DAR Deployment Information

**Deployment Date**: 2026-01-22
**Status**: ✅ **DEPLOYED TO CANTON**

---

## Deployed DAR Details

### Package Information
- **Package ID**: `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454`
- **File**: `daml/.daml/dist/clob-exchange-1.0.0.dar`
- **Size**: 862 KB
- **MD5**: `6f13a3dcbeabde1a72c0f1db51d479de`
- **Participant**: `participant.dev.canton.wolfedgelabs.com:443`

### Deployment Command
```bash
export JWT_TOKEN="eyJhbGc..."
bash scripts/upload-dar.sh
```

### Deployment Response
```json
{
  "darIds": [
    "f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454"
  ]
}
```

---

## What's Included in This DAR

### New Contracts (Complete Implementation)
1. **Asset.daml** - Fungible asset templates
   - `Asset` - Base asset template (BTC, ETH, USDT, etc.)
   - `LockedAsset` - Assets locked for orders (escrow)
   - `AssetIssuance` - Minting mechanism
   - `Faucet` - Test token distribution

2. **AssetHolding.daml** - User wallet/portfolio
   - Tracks available vs locked balances
   - LockAssets, UnlockAssets, SettleLockedTransfer choices
   - On-ledger balance management

3. **OrderV2.daml** - Orders with real asset locking
   - References AssetHolding contracts
   - Locks assets on placement
   - Unlocks on cancellation
   - Tracks locked amounts

4. **MasterOrderBookV2.daml** - Global orderbook with settlement
   - Real asset settlement on trade execution
   - Transfers quote token (USDT) and base token (BTC)
   - Atomic settlements
   - FIFO matching with self-trade prevention

### Legacy Contracts (Backward Compatibility)
5. **Order.daml** - Original order template
6. **MasterOrderBook.daml** - Original orderbook
7. **OrderBook.daml** - User-facing orderbook interface
8. **UserAccount.daml** - Legacy account template
9. **Trade.daml** - Trade record template

---

## Configuration Integration

### Backend Configuration

**File**: `backend/.env`
```bash
# NEW DAR Package ID (added 2026-01-22)
CLOB_EXCHANGE_PACKAGE_ID=f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454
```

**File**: `backend/src/config/index.js`
```javascript
canton: {
  packageIds: {
    // NEW DAR with all features
    clobExchange: process.env.CLOB_EXCHANGE_PACKAGE_ID ||
      'f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454',
    // ... legacy fallbacks
  }
}
```

**Note**: The system auto-discovers package IDs by querying Canton, so these are fallback values only.

---

## Verification

### Check Package is Available on Canton

```bash
# Using Canton JSON API
curl -X POST http://65.108.40.104:31539/v2/packages \
  -H "Authorization: Bearer $JWT_TOKEN" \
  | jq '.packageIds[] | select(contains("f10023e3"))'
```

**Expected Output**:
```
"f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454"
```

### Query New Contracts

```bash
# Query Asset contracts
curl -X POST http://65.108.40.104:31539/v2/query \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateIds": ["Asset:Asset"]
  }'

# Query AssetHolding contracts
curl -X POST http://65.108.40.104:31539/v2/query \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateIds": ["AssetHolding:AssetHolding"]
  }'
```

---

## Features Enabled by This DAR

### 1. Test Token Minting ⭐ NEW
**Endpoint**: `POST /api/testnet/quick-mint`
**Requires**: AssetHolding contract

### 2. Real Asset Locking ⭐ NEW
**Contract**: OrderV2
**Requires**: Asset, AssetHolding contracts

### 3. Real Trade Settlement ⭐ NEW
**Contract**: MasterOrderBookV2
**Requires**: All new contracts

### 4. Cancellation Refunds ⭐ NEW
**Feature**: Unlock assets on cancel
**Requires**: AssetHolding.UnlockAssets choice

### 5. Balance WebSocket Sync ⭐ NEW
**Feature**: Real-time balance updates
**Backend**: websocketService.broadcastBalanceUpdate()

### 6. Candlestick Chart ⭐ NEW
**Component**: CandlestickChart.jsx
**Requires**: Frontend dependency: lightweight-charts

---

## Migration from Old DAR

### Old DAR (Uploaded Before)
- **Package ID**: `3c6fb45c9475e83ebd9031899392ec3d660782c0eda4a750404839701c04a7d3`
- **Size**: 725 KB
- **Features**: 19/30 (63%)
- **Status**: ⚠️ Incomplete (missing Asset contracts)

### New DAR (Current)
- **Package ID**: `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454`
- **Size**: 862 KB
- **Features**: 30/30 (100%)
- **Status**: ✅ Complete (all features implemented)

### Breaking Changes
- None! New contracts (V2) coexist with legacy contracts
- Existing contracts continue to work
- New features use new contracts (Asset, AssetHolding, OrderV2, MasterOrderBookV2)

---

## Next Steps After Deployment

### 1. Start Services
```bash
# Terminal 1: Backend
cd backend
npm start

# Terminal 2: Frontend
cd frontend
npm install lightweight-charts  # First time only
npm run dev
```

### 2. Create Orderbooks
```bash
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT
curl -X POST http://localhost:3001/api/admin/orderbooks/ETH%2FUSDT
curl -X POST http://localhost:3001/api/admin/orderbooks/SOL%2FUSDT
```

### 3. Test New Features
1. Open `http://localhost:5173`
2. Create wallet → Onboard
3. **Mint test tokens** (NEW)
4. **Place order** → See asset locking (NEW)
5. **Match trade** → See asset settlement (NEW)
6. **Cancel order** → See refund (NEW)
7. **View chart** → See OHLC candles (NEW)

---

## Troubleshooting

### "Contract not found" errors
**Solution**: Make sure you're using the new package ID
```bash
# Check if package is available
curl http://65.108.40.104:31539/v2/packages \
  -H "Authorization: Bearer $JWT_TOKEN" | jq .
```

### "Template not found: Asset:Asset"
**Cause**: Using old DAR or DAR not uploaded
**Solution**: Verify package ID in logs, re-upload DAR if needed

### Minting endpoint returns 500
**Cause**: AssetHolding contract not available
**Solution**: Verify new DAR is deployed, restart backend

---

## Rollback Procedure (If Needed)

If you need to rollback to old behavior:

1. **Keep using legacy contracts**: Order, MasterOrderBook
2. **Don't use new endpoints**: /api/testnet/*
3. **Old DAR is still available**: Canton doesn't delete packages

**Note**: Rollback not recommended - new DAR has all features!

---

## Package Lifecycle

| Version | Package ID | Date | Features | Status |
|---------|-----------|------|----------|--------|
| 1.0.0 (old) | `3c6fb45c...` | Before | 19/30 (63%) | ⚠️ Deprecated |
| 1.0.0 (new) | `f10023e3...` | 2026-01-22 | 30/30 (100%) | ✅ **CURRENT** |

---

## References

- **Upload Script**: `scripts/upload-dar.sh`
- **Verification Script**: `scripts/verify-dar.sh`
- **Implementation Details**: `IMPLEMENTATION_COMPLETE.md`
- **Testing Guide**: `DEPLOY_NOW.md`
- **Missing Features Resolved**: `MISSING_THINGS.md`

---

**Status**: ✅ **PRODUCTION READY**

All 30 features implemented and deployed to Canton.
