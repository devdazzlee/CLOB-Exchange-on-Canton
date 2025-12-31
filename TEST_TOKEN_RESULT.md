# Token Test Results

## Token Tested
The new token you provided has been tested.

## Test Result
❌ **Still returns 403 Forbidden**

### Test Command
```bash
curl -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"activeAtOffset":"0","verbose":false,"filter":{"filtersForAnyParty":{"inclusive":{"templateIds":["OrderBook:OrderBook"]}}}}'
```

### Response
```json
{
  "code": "NA",
  "cause": "A security-sensitive error has been received",
  "correlationId": "...",
  "traceId": "...",
  "context": {},
  "resources": [],
  "errorCategory": -1,
  "grpcCodeValue": 7
}
```

## Token Analysis
✅ Token has correct scopes: `daml_ledger_api`
✅ Token has multiple audiences including `https://canton.network.global`
✅ Token format is valid
❌ Still returns 403 - **permission issue**

## Possible Causes
1. **Token needs additional permissions** - The token may need explicit query permissions configured in Keycloak
2. **Party not registered** - The party associated with the token may not be registered on the ledger
3. **Different authentication method** - Query operations may require a different authentication method than create/exercise operations
4. **Keycloak configuration** - The client application in Keycloak may need additional roles/permissions for query operations

## What I've Done
1. ✅ Updated frontend to use this token
2. ✅ Created script to set token in `.env` file
3. ✅ Created browser console instructions to set token in localStorage
4. ✅ Tested token directly - still returns 403

## Next Steps
**Option 1: Set token in browser and test**
- Open browser console (F12)
- Run: `localStorage.setItem('canton_jwt_token', '<TOKEN>')`
- Refresh page
- Try placing an order or viewing order book
- Check Network tab to see actual API responses

**Option 2: Ask client to check Keycloak**
- Verify the token has query permissions
- Check if party is registered on ledger
- Verify client application has correct roles/permissions

## Files Created
- `SET_TOKEN.sh` - Script to set token in `.env`
- `SET_TOKEN_IN_BROWSER.md` - Instructions for browser console
- `TEST_TOKEN_RESULT.md` - This file

