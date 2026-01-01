# Official DAML Documentation Analysis - 403 Error Root Cause

## Key Findings from Official Documentation

### 1. **Access Tokens and Rights**

According to the official DAML documentation, the Ledger API uses specific rights:

- **`canReadAs(p)`**: The right to read information off the ledger (like active contracts) visible to party `p`
- **`canActsAs(p)`**: Same as `canReadAs(p)`, with the added right of issuing commands on behalf of party `p`

### 2. **Required Rights for Query Operations**

**For `ActiveContractsService.GetActiveContracts`:**
- **Required right**: `for each requested party p: canReadAs(p)`

This means **every party you query must have `canReadAs` rights** configured for your user/token.

### 3. **Your Token Type: User Access Token**

Based on your token structure, you have a **Scope-Based User Access Token**:

```json
{
  "aud": ["https://canton.network.global", ...],
  "sub": "8100b2db-86cf-40a1-8351-55483c151cdc",
  "scope": "openid offline_access profile daml_ledger_api wallet_audience email",
  "iss": "https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet"
}
```

### 4. **Critical Difference: User Access Tokens vs Custom Claims**

**User Access Tokens** (what you have):
- Do **NOT** encode rights directly in the token
- The participant node **looks up the user's current rights** from the User Management Service
- Rights are stored **on the participant node**, not in the token
- Rights can be changed dynamically without issuing new tokens

**Custom Daml Claims Tokens**:
- Encode rights directly in the token (`readAs`, `actAs` arrays)
- Rights are in the token itself
- Cannot be changed without issuing a new token

### 5. **Why You're Getting 403**

Since you're using a **User Access Token**, the participant node:
1. Validates your token ✅ (works - you're authenticated)
2. Looks up user `8100b2db-86cf-40a1-8351-55483c151cdc` in User Management ❌
3. Checks if user has `canReadAs` rights for the parties being queried ❌
4. Returns 403 if rights are missing ❌

## Root Cause Identified

**The user `8100b2db-86cf-40a1-8351-55483c151cdc` does not have `canReadAs` rights configured on the participant node.**

Even though:
- ✅ Your token is valid
- ✅ Your token has `daml_ledger_api` scope
- ✅ Your token has correct audience

The participant node cannot find `canReadAs` rights for your user, so it denies the query request.

## Solution

### Option 1: Configure User Rights (Recommended)

The participant operator needs to configure user rights using the **User Management Service**:

1. **Grant `canReadAs` rights** to user `8100b2db-86cf-40a1-8351-55483c151cdc`
2. **Specify which parties** the user can read as
3. **For querying all contracts**, grant `canReadAs` for all relevant parties

**Example using User Management API:**
```bash
# Grant canReadAs rights to user
# (This would be done by participant operator)
```

### Option 2: Use Custom Daml Claims Token

Instead of a User Access Token, use a **Custom Daml Claims Token** with explicit rights:

```json
{
  "https://daml.com/ledger-api": {
    "readAs": ["Alice", "Bob", ...],  // Parties you can read as
    "actAs": ["Alice"]                 // Parties you can act as
  },
  "exp": 1300819380
}
```

However, this requires:
- Token issuer that supports custom claims
- Explicit party list in token
- New token when parties change

### Option 3: Query Specific Parties

If you know which parties you need to query, you can:
1. Query with `filtersByParty` instead of `filtersForAnyParty`
2. Only query parties for which your user has `canReadAs` rights

## What to Ask the Client

Based on the official documentation, ask the client:

1. **Is user `8100b2db-86cf-40a1-8351-55483c151cdc` registered in User Management?**
   - Check: `UserManagementService.GetUser`

2. **Does the user have `canReadAs` rights configured?**
   - Check: `UserManagementService.ListUserRights`
   - Should include: `canReadAs` for relevant parties

3. **Which parties should this user be able to read?**
   - For querying all contracts: needs `canReadAs` for all parties
   - For specific queries: needs `canReadAs` for those specific parties

4. **Can you grant `canReadAs` rights to this user?**
   - Use: `UserManagementService.GrantUserRights`
   - Grant: `canReadAs` for the required parties

## Documentation References

- **Access Tokens and Rights**: https://docs.daml.com/app-dev/access-tokens.html#access-tokens-and-rights
- **User Access Tokens**: https://docs.daml.com/app-dev/access-tokens.html#user-access-tokens
- **Required Rights Table**: Shows `canReadAs(p)` required for `GetActiveContracts`

## Summary

**The 403 error is caused by missing `canReadAs` rights for user `8100b2db-86cf-40a1-8351-55483c151cdc`.**

Your token is valid, but the participant node cannot find the required `canReadAs` rights for query operations. The solution is to configure user rights on the participant node using the User Management Service.



