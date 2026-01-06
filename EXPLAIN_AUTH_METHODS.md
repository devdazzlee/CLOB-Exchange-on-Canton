# What Does "Different Authentication Method" Mean?

## Understanding Query vs Command Operations

In Canton/DAML systems, there are **two main types of operations**:

### 1. **Query Operations** (Read/View)
- **Purpose**: Read data from the ledger
- **Examples**: 
  - Query active contracts
  - View order book
  - Check balances
- **Endpoint**: `/v2/state/active-contracts`
- **Authentication**: May require:
  - Query permissions in Keycloak
  - Party to be registered as an observer
  - Different token scopes than write operations

### 2. **Command Operations** (Write/Execute)
- **Purpose**: Modify the ledger state
- **Examples**:
  - Create contracts
  - Exercise choices (place order, cancel order)
- **Endpoint**: `/v2/commands/submit-and-wait`
- **Authentication**: May require:
  - Write permissions in Keycloak
  - Party to be a signatory
  - Different token scopes than read operations

## Why This Matters

Some systems separate read and write permissions:

### Scenario 1: Separate Permissions
```
Token A: Can read contracts (query) ✅
Token B: Can write contracts (commands) ✅
Token C: Can do both (read + write) ✅
```

### Scenario 2: Same Token, Different Scopes
```
Token with scope "daml_ledger_api:read" → Can query ✅
Token with scope "daml_ledger_api:write" → Can create/exercise ✅
Token with scope "daml_ledger_api:read daml_ledger_api:write" → Can do both ✅
```

### Scenario 3: Party Registration
```
Party registered as "Observer" → Can query contracts ✅
Party registered as "Signatory" → Can create/exercise contracts ✅
Party not registered → Cannot do anything ❌
```

## In Your Case

**What's happening:**
- Your token has `daml_ledger_api` scope ✅
- But query operations return 403 ❌
- This suggests the token might:
  1. **Not have query permissions** - Token can write but not read
  2. **Party not registered** - The party in the token isn't registered on ledger
  3. **Need different token** - Query operations need a different token/scope

## What to Check

### Option 1: Check Token Scopes
Look at your token payload (decode JWT):
```json
{
  "scope": "openid offline_access profile daml_ledger_api wallet_audience email"
}
```

Does it have `daml_ledger_api:read` or just `daml_ledger_api`?

### Option 2: Check Party Registration
The party ID in your token (`8100b2db-86cf-40a1-8351-55483c151cdc`) needs to be:
- Registered on the Canton ledger
- Have observer permissions (for queries)

### Option 3: Try Write Operation
Test if you can **create** a contract (write operation):
- If write works but read doesn't → Permission issue
- If both fail → Token/party issue

## Most Likely Cause

Based on the 403 error, the most likely cause is:

**The token doesn't have query permissions configured in Keycloak**

Even though it has `daml_ledger_api` scope, the Keycloak client application might not be configured to allow query operations.

## Solution

Ask the client to:
1. **Check Keycloak client configuration** - Ensure query permissions are enabled
2. **Verify party registration** - Make sure the party is registered on ledger
3. **Provide a token with explicit query permissions** - Or configure the current token to have query access

---

**TL;DR**: Query (read) and Command (write) operations might need different permissions. Your token might work for writing but not reading, or vice versa.




