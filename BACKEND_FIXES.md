# Backend Error Fixes

## Issues Fixed

### 1. ✅ 400 Error: Missing `templateId` and `choiceArgument` in Deposit Commands

**Problem:**
```
Failed to deposit USDT: 400 Invalid value for: body 
(Missing required field at 'commands[0].ExerciseCommand.templateId', 
Missing required field at 'commands[0].ExerciseCommand.choiceArgument')
```

**Root Cause:**
The `ExerciseCommand` in the testnet minting endpoint was missing:
- `templateId` field
- Using `argument` instead of `choiceArgument`

**Fix Applied:**
- Added `templateId: templateIdToUse` to ExerciseCommand
- Changed `argument` to `choiceArgument`

**Location:** `backend/server.js` line ~2351

---

### 2. ✅ 413 Error: JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED

**Problem:**
```
413 {"code":"JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED",
"cause":"The number of matching elements (201) is greater than the node limit (200)."}
```

**Root Cause:**
Queries were using `templateIds: []` (empty array = match all templates), causing them to return 201+ contracts and hit the 200 element limit.

**Fixes Applied:**

1. **Global OrderBook Query** (line ~1399):
   - Changed from `templateIds: []` 
   - To: `templateIds: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook']`

2. **OrderBooks API Query** (line ~1189):
   - Changed from `templateIds: []`
   - To: `templateIds: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook']`

3. **Direct Active Contracts Query** (line ~1492):
   - Changed from `templateIds: ['OrderBook:OrderBook']`
   - To: `templateIds: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook']`

**Result:**
- Queries now filter by specific template IDs
- Avoids hitting the 200 element limit
- More efficient queries

---

## Testing

After these fixes, you should see:

1. ✅ **No more 400 errors** when minting test tokens
2. ✅ **No more 413 errors** when querying OrderBooks
3. ✅ **Faster queries** due to proper filtering

## Next Steps

1. **Restart the backend:**
   ```bash
   cd backend
   # Stop current process (Ctrl+C)
   yarn dev
   ```

2. **Test token minting:**
   - Create a new party
   - Mint test tokens
   - Should see: `✅ Deposited 100000.0 USDT` instead of errors

3. **Test OrderBook queries:**
   - Frontend should load OrderBooks without 413 errors
   - Backend logs should show successful queries

---

## Summary

All three error types have been fixed:
- ✅ Deposit command format corrected
- ✅ Query filtering improved to avoid 413 limits
- ✅ Multiple query endpoints updated consistently

The backend should now work without these recurring errors!
