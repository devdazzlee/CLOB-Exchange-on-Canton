# Splice Token Standard Integration Guide

## Overview

This document describes the changes required to integrate the CLOB Exchange with the **Splice Token Standard** and **Allocation Model**, following the pattern from `TradingApp.daml`.

## Architecture Changes

### Before (Generic Transfers)
- Users directly transfer tokens
- Orders hold `amount` and `currency` fields
- Venue executes trades by transferring tokens directly

### After (Splice Allocation Model)
- Users create **`Allocation`** contracts (lock funds) favoring the Venue
- Orders hold `allocationCid : ContractId Allocation`
- Venue executes trades by calling `Allocation_ExecuteTransfer` (like `OTCTrade_Settle`)

## DAML Contracts (✅ COMPLETED)

### 1. `daml.yaml`
- Updated with Splice dependencies:
  - `splice-token-standard`
  - `splice-wallet-api`

### 2. `daml/Order.daml`
- **Added:** `allocationCid : ContractId Api.Token.AllocationV1.Allocation`
- **Changed:** `CancelOrder` now calls `Allocation_Cancel` to unlock funds
- **Signatory:** Changed from `operator` to `owner` (user owns the order and allocation)

### 3. `daml/MasterOrderBook.daml`
- **`AddOrder` choice:** Now accepts `allocationCid` parameter
- **`MatchOrders` choice:** Executes trades using `Allocation_ExecuteTransfer`
- **`executeMatch` function:** Follows `OTCTrade_Settle` pattern from `TradingApp.daml`

## Frontend Changes (🔧 REQUIRED)

### File: `frontend/src/services/TradingService.ts` (or equivalent)

**Current Flow:**
```typescript
// Old: Direct order placement
const placeOrder = async (orderData) => {
  // Call backend to create Order contract
  await fetch('/api/orders/place', { ... });
}
```

**New Flow (Splice Allocation):**
```typescript
import { queryContracts, exerciseChoice } from './cantonApi';

const placeOrder = async (orderData) => {
  const { partyId, tradingPair, orderType, quantity, price } = orderData;
  
  // STEP 1: Find user's Token contracts (UTXOs)
  const tokens = await queryContracts('Token:Token', partyId);
  
  // STEP 2: Determine which token to lock
  const (baseToken, quoteToken) = parseTradingPair(tradingPair);
  const tokenToLock = orderType === 'BUY' ? quoteToken : baseToken; // BUY = lock USDT, SELL = lock BTC
  
  // Find a Token contract with sufficient balance
  const tokenContract = tokens.find(t => 
    t.payload?.currency === tokenToLock && 
    parseFloat(t.payload?.amount || '0') >= parseFloat(quantity)
  );
  
  if (!tokenContract) {
    throw new Error(`Insufficient ${tokenToLock} balance`);
  }
  
  // STEP 3: Create Allocation by calling Token_Lock (or equivalent Splice choice)
  // The Allocation locks funds to the Operator/Venue
  const OPERATOR_PARTY_ID = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
  
  const allocationResult = await exerciseChoice(
    tokenContract.contractId,
    'Token:Token_Lock', // Adjust based on actual Splice API
    {
      receiver: partyId, // User receives the locked allocation
      provider: OPERATOR_PARTY_ID, // Venue can execute
      amount: quantity,
      // Additional fields may be required based on Splice API
    }
  );
  
  // STEP 4: Extract Allocation contract ID from result
  const allocationCid = allocationResult.createdContracts?.find(
    c => c.templateId?.includes('Allocation')
  )?.contractId;
  
  if (!allocationCid) {
    throw new Error('Failed to create Allocation');
  }
  
  // STEP 5: Submit order with Allocation CID to MasterOrderBook
  const orderResult = await exerciseChoice(
    masterOrderBookContractId,
    'MasterOrderBook:AddOrder',
    {
      orderId: generateOrderId(),
      owner: partyId,
      orderType: orderType,
      orderMode: orderMode || 'LIMIT',
      price: price ? Some price : None,
      quantity: quantity,
      allocationCid: allocationCid // CRITICAL: Pass the Allocation
    }
  );
  
  return orderResult;
};
```

### File: `frontend/src/components/TradingInterface.jsx`

**Update `handlePlaceOrder` function:**
- Replace direct order placement with the Splice Allocation flow above
- Update error handling for Allocation creation failures
- Show user-friendly messages about "locking funds" instead of "transferring funds"

## Backend Changes (🔧 REQUIRED)

### File: `backend/server.js` - Order Placement Endpoint

**Current Endpoint:** `POST /api/orders/place`

**Required Changes:**
1. **Remove direct token transfer logic**
2. **Add Allocation creation logic** (or delegate to frontend)
3. **Update order creation** to accept `allocationCid`

**New Endpoint Logic:**
```javascript
app.post('/api/orders/place', async (req, res) => {
  const { partyId, tradingPair, orderType, quantity, price, allocationCid } = req.body;
  
  // Validate Allocation exists and is valid
  if (!allocationCid) {
    return res.status(400).json({ 
      error: 'Allocation CID required. Create Allocation first using Token_Lock.' 
    });
  }
  
  // Verify Allocation is locked to Operator
  const allocation = await fetchContract(allocationCid);
  // ... validation logic ...
  
  // Create Order with Allocation CID
  const orderResult = await exerciseChoice(
    masterOrderBookContractId,
    'MasterOrderBook:AddOrder',
    {
      orderId: generateOrderId(),
      owner: partyId,
      orderType,
      orderMode: orderMode || 'LIMIT',
      price: price ? { Some: price } : { None: null },
      quantity,
      allocationCid // Pass the Allocation
    }
  );
  
  res.json({ success: true, ...orderResult });
});
```

### File: `backend/matchmaker.ts` (or equivalent)

**Current Logic:** Scans orders and matches them

**Required Changes:**
- **No changes needed** - The `MasterOrderBook:MatchOrders` choice already handles Allocation execution
- The Operator (backend) has authority to execute Allocations because they were created with Operator as provider

**Note:** The backend's admin token must have permission to exercise `Allocation_ExecuteTransfer` on Allocations where the Operator is the provider.

## Critical Implementation Notes

### 1. Allocation Creation
- **BUY orders:** Lock quote token (USDT) - user wants to buy base token (BTC)
- **SELL orders:** Lock base token (BTC) - user wants to sell base token
- **Provider:** Always set to Operator/Venue party ID
- **Receiver:** Set to the user (they receive the locked allocation)

### 2. Allocation Execution
- The `executeMatch` function in `MasterOrderBook.daml` calls `Allocation_ExecuteTransfer`
- **Important:** The exact signature of `Allocation_ExecuteTransfer` may vary based on your Splice version
- Adjust the `extraArgs` parameter based on actual Splice API documentation

### 3. Partial Fills
- Current implementation assumes **full match** (exact quantity)
- For partial fills, you'll need to:
  - Create new Allocations for remaining quantities
  - Or use Splice's partial execution capabilities (if available)

### 4. Error Handling
- **Allocation creation failures:** User doesn't have sufficient balance or Token contract not found
- **Allocation execution failures:** Allocation may have been cancelled or already executed
- **Order placement failures:** Allocation validation failed (wrong provider, wrong token type, etc.)

## Testing Checklist

- [ ] User can create Allocation for BUY order (locks USDT)
- [ ] User can create Allocation for SELL order (locks BTC)
- [ ] Order placement with Allocation CID succeeds
- [ ] Order cancellation releases Allocation (unlocks funds)
- [ ] Order matching executes Allocations correctly
- [ ] Trade records are created after successful match
- [ ] Partial fills handled correctly (if implemented)

## Migration Path

1. **Deploy new DAML contracts** (MasterOrderBook, Order with Allocation support)
2. **Update frontend** to create Allocations before placing orders
3. **Update backend** to accept Allocation CIDs in order placement
4. **Test thoroughly** with small quantities
5. **Migrate existing orders** (if any) - may need to cancel and recreate with Allocations

## References

- `TradingApp.daml` - Reference implementation for OTC trades using Splice
- Splice Token Standard documentation
- `Splice.Api.Token.AllocationV1` - Allocation API
- `Splice.Api.Token.MetadataV1` - Token metadata API
