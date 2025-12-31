# Message to Client - API Authentication Issue

---

Hi [Client Name],

I've completed the frontend integration with the Canton JSON API, but I'm encountering a **403 Forbidden** error when trying to query contracts from the ledger.

## Issue

The JWT token you provided has the correct scopes (`daml_ledger_api`), but it appears to lack the necessary **permissions to query contracts** from the JSON API endpoint.

**Error Details:**
- Endpoint: `POST /v2/state/active-contracts`
- Status: `403 Forbidden`
- Error: "A security-sensitive error has been received"
- This occurs even when querying with `filtersForAnyParty` (which should work for any party)

## What I Need

I need a JWT token that has:
1. ✅ `daml_ledger_api` scope (already have this)
2. ❌ **Query permissions** for the JSON API endpoint
3. ❌ **Read access** to active contracts

## Possible Solutions

**Option 1:** Provide a new token with proper query permissions
- The token should allow querying contracts via `/v2/state/active-contracts`
- It should work with `filtersForAnyParty` filter

**Option 2:** Check Keycloak configuration
- Verify the token has the correct audience/audiences for the JSON API
- Ensure the client/application has query permissions enabled
- Check if there are any role-based access controls that need to be configured

**Option 3:** Alternative authentication method
- If there's a different way to authenticate for query operations, please let me know

## Current Status

✅ Frontend is fully integrated and ready
✅ Token authentication is implemented
✅ Error handling is in place
❌ Cannot query contracts due to 403 errors
❌ Cannot verify OrderBook existence before placing orders

## Next Steps

Once I receive a token with proper query permissions, I can:
1. Test contract queries
2. Verify OrderBook creation
3. Complete end-to-end testing
4. Deliver the fully functional application

Please let me know how you'd like to proceed, or if you need any additional information from my side.

Thanks!

---

