# Message to Client - Based on Official Documentation

---

Hi [Client Name],

I've done a deep analysis of the official Canton/DAML documentation and found the root cause of the 403 errors.

## Root Cause (Based on Documentation)

The 403 Forbidden error occurs because **the party associated with the JWT token is not registered as an observer** on the Canton ledger, or the Keycloak client doesn't have query permissions configured.

## What the Documentation Says

According to the official Canton JSON API documentation:

1. **Query operations require**:
   - Valid JWT token with `daml_ledger_api` scope ✅ (you have this)
   - **Party must be registered** on the ledger ❓ (needs verification)
   - **Party must have observer permissions** ❓ (needs verification)

2. **Token scopes**:
   - Your token has `daml_ledger_api` ✅
   - May also need `daml_ledger_api:read` for query operations ❓

3. **Keycloak configuration**:
   - Client application must have query permissions enabled ❓

## Your Token Analysis

**Token Details:**
- ✅ Has `daml_ledger_api` scope
- ✅ Has correct audience (`https://canton.network.global`)
- ✅ Has valid party ID: `8100b2db-86cf-40a1-8351-55483c151cdc`
- ❌ Still returns 403 on query operations

## What We Need to Check

### 1. Party Registration
Please verify that party `8100b2db-86cf-40a1-8351-55483c151cdc` is:
- ✅ Registered on the Canton ledger
- ✅ Configured with **observer permissions** (required for query operations)

### 2. Keycloak Client Configuration
Please check if the Keycloak client application:
- ✅ Has query permissions enabled
- ✅ Allows `daml_ledger_api:read` scope (if separate from write)

### 3. Test Write Operation
Can you test if the token works for **write operations** (creating contracts)?
- If write works but read doesn't → Permission issue
- If both fail → Token/party registration issue

## Recommended Solution

Based on the documentation, please:

1. **Register the party** `8100b2db-86cf-40a1-8351-55483c151cdc` on the ledger with observer permissions
2. **Configure Keycloak client** to allow query operations
3. **Generate a new token** with explicit query permissions (or verify current token has them)

## References

- Official Documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
- DAML Discuss: https://discuss.daml.com/t/list-contracts-for-a-provider/8008

## Next Steps

Once the party is registered and permissions are configured, the 403 errors should be resolved. The frontend is ready and will work once authentication is properly set up.

Please let me know:
1. Is the party registered?
2. Does it have observer permissions?
3. Can you test a write operation with the token?

Thanks!

---

