# Order Visibility Issue - Deep Diagnosis

## Problem
- OrderBook creation succeeds (200 OK, `updateId` received)
- Orders are placed successfully (200 OK, `updateId` received)
- But queries for Order contracts return empty arrays `[]`
- Order book shows no orders
- Active orders list is empty

## Root Cause Analysis

### 1. **Order Template Visibility Rules**
```daml
template Order
  with
    owner : Party
    operator : Party
  where
    signatory operator
    observer owner
```

**When OrderBook is created:**
- `operator` = `partyId` (user's party ID)

**When Order is placed via AddOrder:**
- `operator` = OrderBook's `operator` = `partyId` (same as OrderBook creator)
- `owner` = `partyId` (user placing the order)

**Result:** User should see orders as BOTH signatory (operator) AND observer (owner).

### 2. **Order Creation Flow**
1. User exercises `AddOrder` choice on OrderBook
2. Order contract is created with `operator` and `owner` both set to `partyId`
3. `MatchOrders` is automatically called
4. `MatchOrders` tries to match orders and may fill them immediately
5. Filled orders are removed from OrderBook's `buyOrders`/`sellOrders` arrays

### 3. **Potential Issues**

#### Issue A: Orders Being Immediately Matched/Filled
- If `MatchOrders` finds a match, orders are filled immediately
- Filled orders are removed from OrderBook arrays
- But filled orders should still exist on ledger (status="FILLED")
- **However:** If orders are archived after being filled, they won't appear in active contracts queries

#### Issue B: ContractId Format Mismatch
- ContractIds in OrderBook's `buyOrders`/`sellOrders` arrays might be in wrong format
- DAML ContractIds are strings, but might be serialized differently in JSON API
- `fetchContracts()` might not be able to resolve them

#### Issue C: Query Timing Issue
- Orders are created but queries happen before they're visible
- Even with `completionOffset`, there might be propagation delays

#### Issue D: Order Archival
- If orders are matched and filled, they might be archived (deleted from ledger)
- Archived contracts don't appear in active contracts queries
- Need to check if orders are being archived

## Diagnostic Steps Added

### 1. Enhanced Logging in `exerciseChoice()`
- Logs full API response
- Queries for created Order contract after `AddOrder`
- Checks both `completionOffset` and current ledger end
- Logs all found Order contracts with details

### 2. Enhanced Logging in `loadOrderBook()`
- Logs OrderBook details including ContractId arrays
- Logs ContractId types and formats
- Logs fetch results

### 3. Enhanced Logging in `loadOrders()`
- Logs query results
- Warns if no orders found with possible reasons

## Next Steps to Diagnose

1. **Check Browser Console** after placing an order:
   - Look for `[Exercise Choice]` logs
   - Check if orders are found after creation
   - Check ContractId formats

2. **Check OrderBook Payload**:
   - Verify `buyOrders` and `sellOrders` arrays contain ContractIds
   - Check ContractId format (should be strings starting with "00")

3. **Check if Orders Are Being Archived**:
   - Query for Order contracts with different statuses
   - Check if filled orders still exist

4. **Verify Order Creation**:
   - Check if `AddOrder` actually creates orders
   - Verify the transaction succeeds

## Expected Behavior

After placing an order:
1. `AddOrder` choice is exercised → returns `updateId` and `completionOffset`
2. Order contract is created on ledger
3. Order should be visible in queries for Order contracts
4. Order should appear in OrderBook's `buyOrders` or `sellOrders` array
5. Order should appear in "Your Active Orders" list

## Current Behavior

After placing an order:
1. ✅ `AddOrder` choice is exercised → returns `updateId` and `completionOffset`
2. ❓ Order contract creation status unknown
3. ❌ Order NOT visible in queries for Order contracts (returns `[]`)
4. ❌ Order NOT in OrderBook arrays (arrays are empty)
5. ❌ Order NOT in "Your Active Orders" list

## Most Likely Root Cause

**Orders are being created but immediately archived** due to:
1. `MatchOrders` being called automatically after `AddOrder`
2. Orders matching with themselves or other orders
3. Orders being filled and archived

**OR**

**Orders are being created but ContractIds are not being stored correctly** in OrderBook's arrays, so they can't be fetched.

## Solution Approach

1. **Add logging** to verify orders are created ✅ (Done)
2. **Check if orders are being archived** - need to query transaction history
3. **Verify ContractId storage** in OrderBook payload
4. **Check MatchOrders logic** - might be matching orders incorrectly
5. **Consider disabling auto-matching** for testing


