# Deployment Instructions

## Current Status

✅ **DAR file built**: `.daml/dist/clob-exchange-1.0.0.dar`  
⚠️ **DAR upload**: Appears to be uploaded (got duplicate error, which means it exists)  
❌ **OrderBook creation**: Failing because backend can't find correct package ID

## The Problem

The backend is trying to use a specific package ID (`dd43244140e4d07f8ae813d1037b87476e253dea70569bce1a80169353bfbbe0`) but the actual package ID on Canton might be different.

## Solution Options

### Option 1: Try Creating OrderBooks with Unqualified Template ID

The backend should try creating OrderBooks with just `OrderBook:OrderBook` (without package ID) first. Canton should resolve it automatically.

**Try this:**
```bash
cd backend
npm run init-orderbooks
```

If it still fails, the backend code needs to be updated to handle package ID resolution better.

### Option 2: Find the Correct Package ID

1. Query Canton to find packages containing "clob-exchange" or "OrderBook"
2. Update backend to use the correct package ID
3. Or modify backend to try multiple package IDs

### Option 3: Use Canton Admin UI

If you have access to Canton Admin UI:
1. Upload the DAR file: `.daml/dist/clob-exchange-1.0.0.dar`
2. Note the package ID that gets assigned
3. Update backend environment variable or code with that package ID

### Option 4: Contact Canton Administrator

Since the DAR appears to be uploaded (duplicate error), ask your Canton administrator to:
1. Verify the package is uploaded
2. Provide the correct package ID
3. Or help troubleshoot why templates aren't being found

## Quick Test

Try creating an OrderBook directly via API to see the exact error:

```bash
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT \
  -H "Content-Type: application/json"
```

Check the backend logs for the exact package ID being used and the error message.

## Next Steps

1. **Check backend logs** when creating OrderBooks - they should show what package ID is being used
2. **Try the unqualified template ID** - modify backend to try `OrderBook:OrderBook` without package prefix
3. **Query Canton directly** to find the correct package ID
4. **Update backend** to use the correct package ID or auto-detect it better

## Files Ready

- ✅ DAR file: `.daml/dist/clob-exchange-1.0.0.dar`
- ✅ Backend scripts: `backend/scripts/initialize-orderbooks.js`
- ✅ Backend running on: `http://localhost:3001`

The deployment is 90% complete - just need to resolve the package ID issue!

