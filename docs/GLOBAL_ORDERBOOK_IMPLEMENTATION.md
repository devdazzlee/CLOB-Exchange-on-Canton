# Global OrderBook Implementation - Complete Solution

## Overview
This document explains how the global OrderBook is implemented to meet the client's requirement: **"The order book should be global (not per user), like Hyperliquid and Lighter."**

## Architecture

### 1. DAML Contract (`OrderBook.daml`)
- **One OrderBook per trading pair**: Enforced by contract key `key tradingPair : Text`
- **Operator as signatory**: Only the operator creates OrderBooks
- **Global visibility**: All users interact with the same OrderBook for each trading pair
- **Active users tracking**: Tracks which parties have placed orders (for analytics)

### 2. Visibility Model
**Challenge**: In DAML, contracts are only visible to their signatories and observers. Since OrderBooks are signed only by the operator, regular users can't see them directly.

**Solution**:
1. **Backend Discovery**: Backend endpoint `/api/orderbooks` queries OrderBooks using operator's token (since operator is signatory)
2. **Contract ID Distribution**: Backend provides OrderBook contract IDs to users
3. **Choice Exercise**: Users exercise `AddOrder` using the contract ID provided by backend
4. **Contract Key**: Users can also use `fetchByKey` to lookup OrderBook by trading pair (if they have visibility)

### 3. Backend API Endpoints

#### `GET /api/orderbooks`
- Queries all OrderBooks using operator's token
- Returns list of global OrderBooks with contract IDs
- Used by frontend to populate trading pair dropdown

#### `GET /api/orderbooks/:tradingPair`
- Gets specific OrderBook for a trading pair
- Returns contract ID that users can use to exercise choices

### 4. Frontend Integration

#### Trading Pair Discovery
- `getAvailableTradingPairs()`: Calls backend endpoint to get list of available trading pairs
- Dynamically populates dropdown with only pairs that have OrderBooks

#### OrderBook Loading
- `loadOrderBook()`: First tries backend endpoint to get global OrderBook contract ID
- Falls back to direct query if backend unavailable
- Uses contract ID from backend to fetch full OrderBook details

#### Order Placement
- `handlePlaceOrder()`: Gets OrderBook contract ID from backend
- Exercises `AddOrder` choice using the global OrderBook contract ID
- All users place orders on the same global OrderBook

### 5. Admin Script (`scripts/create-orderbook.js`)
- **Purpose**: Operator uses this to initialize global OrderBooks for trading pairs
- **Usage**: `node scripts/create-orderbook.js [operator-party-id]`
- **Creates**: One OrderBook per trading pair (BTC/USDT, ETH/USDT, etc.)
- **Initialization**: Creates OrderBook with empty order lists and empty activeUsers

## How It Works (Step by Step)

1. **Operator Initialization**:
   - Operator runs `scripts/create-orderbook.js` to create global OrderBooks
   - Each OrderBook is created with `operator` as signatory
   - Trading pair is used as contract key (ensures uniqueness)

2. **User Discovery**:
   - User opens trading interface
   - Frontend calls `GET /api/orderbooks` to discover available trading pairs
   - Backend queries using operator token and returns list of OrderBooks
   - Dropdown is populated with available pairs

3. **User Views OrderBook**:
   - User selects trading pair (e.g., "BTC/USDT")
   - Frontend calls `GET /api/orderbooks/BTC/USDT` to get OrderBook contract ID
   - Frontend fetches OrderBook details using contract ID
   - All users see the same order book data

4. **User Places Order**:
   - User fills order form and submits
   - Frontend gets OrderBook contract ID from backend (if not already cached)
   - Frontend exercises `AddOrder` choice on the global OrderBook
   - Order is added to the shared OrderBook
   - Order matching runs (controller: operator)
   - All users can see the updated OrderBook

## Key Features

✅ **One OrderBook per trading pair** (enforced by contract key)
✅ **All users see the same orders** (global visibility via backend)
✅ **Order matching across all users** (orders from different users match)
✅ **No per-user OrderBooks** (users cannot create OrderBooks)
✅ **Operator-managed** (only operator creates OrderBooks via admin script)

## Files Modified

1. `daml/OrderBook.daml`: Added contract key, activeUsers tracking
2. `backend/server.js`: Added `/api/orderbooks` endpoints
3. `frontend/src/services/cantonApi.js`: Updated `getAvailableTradingPairs()` and added `getOrderBookContractId()`
4. `frontend/src/components/TradingInterface.jsx`: Updated `loadOrderBook()` and `handlePlaceOrder()` to use backend
5. `scripts/create-orderbook.js`: Updated to include `activeUsers` field

## Testing

To test the global OrderBook:

1. **Create OrderBook** (as operator):
   ```bash
   export CANTON_JWT_TOKEN="<operator-token>"
   node scripts/create-orderbook.js <operator-party-id>
   ```

2. **Open frontend** and verify:
   - Trading pair dropdown shows only pairs with OrderBooks
   - All users see the same OrderBook for each pair
   - Orders placed by one user appear for all users
   - Orders match across users

## Notes

- **Visibility Limitation**: In DAML, contracts are only visible to signatories and observers. Since we can't dynamically add all users as observers (DAML syntax limitation), we use backend queries to discover OrderBooks.
- **Future Improvement**: Consider using DAML's explicit contract disclosure or public party patterns if the visibility model needs to be more open.

