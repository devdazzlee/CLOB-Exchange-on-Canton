# Deep Documentation Analysis: Canton JSON API Authentication & 403 Errors

## Official Documentation References

### Primary Documentation
- **JSON Ledger API v2**: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
- **DAML Discuss Forum**: https://discuss.daml.com/t/list-contracts-for-a-provider/8008

---

## Key Findings from Documentation

### 1. **403 Forbidden Error Causes**

Based on official documentation and community discussions:

#### A. Insufficient Permissions
- **Root Cause**: The JWT token lacks the required permissions for the specific operation
- **Example**: Attempting to query active contracts without appropriate query permissions
- **Reference**: [discuss.daml.com](https://discuss.daml.com/t/list-contracts-for-a-provider/8008)

#### B. Token Scope Limitations
- **Read vs Write Permissions**: Tokens can be scoped differently for:
  - **Query operations** (read): `/v2/state/active-contracts`
  - **Command operations** (write): `/v2/commands/submit-and-wait`
- **Key Finding**: A token with `daml_ledger_api` scope may still need **explicit query permissions**

#### C. Party Registration & Observer Permissions
- **Critical**: The party associated with the token must be:
  1. **Registered** on the Canton ledger
  2. **Configured as observer** (for query operations)
  3. **Configured as signatory** (for command operations)

### 2. **Authentication Requirements**

#### JWT Token Requirements
According to Canton JSON API documentation:

```json
{
  "iss": "https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet",
  "aud": ["https://canton.network.global", "account"],
  "scope": "openid profile daml_ledger_api",
  "sub": "<party-id>"
}
```

#### Required Scopes
- `daml_ledger_api` - Base scope for ledger access
- **May need additional scopes**:
  - `daml_ledger_api:read` - For query operations
  - `daml_ledger_api:write` - For command operations

### 3. **Query Operations Specific Requirements**

#### `/v2/state/active-contracts` Endpoint

**Request Format**:
```json
{
  "activeAtOffset": "0",
  "verbose": false,
  "filter": {
    "filtersForAnyParty": {
      "inclusive": {
        "templateIds": ["OrderBook:OrderBook"]
      }
    }
  }
}
```

**Authentication Requirements**:
1. Valid JWT token with `daml_ledger_api` scope
2. Token must have **query permissions** configured in Keycloak
3. Party in token (`sub` claim) must be registered on ledger
4. Party must have **observer** permissions for query operations

### 4. **Common 403 Error Scenarios**

#### Scenario 1: Token Has Write But Not Read Permissions
```
Token Scope: daml_ledger_api:write
Operation: Query contracts
Result: 403 Forbidden
Reason: Token lacks query/read permissions
```

#### Scenario 2: Party Not Registered
```
Token: Valid with correct scopes
Party: Not registered on ledger
Result: 403 Forbidden
Reason: Party doesn't exist on ledger
```

#### Scenario 3: Party Not Configured as Observer
```
Token: Valid
Party: Registered but not as observer
Operation: Query contracts
Result: 403 Forbidden
Reason: Party lacks observer permissions
```

### 5. **Keycloak Configuration Requirements**

Based on documentation analysis:

#### Client Configuration
- **Client ID**: Must be configured with appropriate scopes
- **Scopes**: Must include `daml_ledger_api` and potentially `daml_ledger_api:read`
- **Roles**: May need specific roles for query operations

#### Token Claims
- **`aud` (Audience)**: Must include Canton network audience
- **`scope`**: Must include `daml_ledger_api`
- **`sub` (Subject)**: Must be a registered party ID

### 6. **Solutions from Documentation**

#### Solution 1: Verify Token Permissions
```bash
# Decode JWT token to check scopes
echo "<token>" | cut -d. -f2 | base64 -d | jq .
```

Check for:
- `daml_ledger_api` in `scope`
- Valid `aud` (audience)
- Valid `sub` (party ID)

#### Solution 2: Check Party Registration
```bash
# Query party details (if API allows)
curl -X GET "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/parties/<party-id>" \
  -H "Authorization: Bearer <token>"
```

#### Solution 3: Request Token with Query Permissions
Ask Keycloak administrator to:
1. Configure client with `daml_ledger_api:read` scope
2. Ensure party is registered as observer
3. Generate new token with query permissions

### 7. **Best Practices from Documentation**

#### Token Management
1. **Separate tokens** for different operations (if needed)
2. **Refresh tokens** before expiration
3. **Validate token** before making requests

#### Error Handling
1. **Check token expiration** first (401 error)
2. **Check permissions** second (403 error)
3. **Check party registration** third (403 error)

#### Testing Approach
1. **Test write operation first** (create contract)
   - If write works → Token has write permissions
   - If write fails → Token/party issue
2. **Test read operation second** (query contracts)
   - If read fails but write works → Permission issue
   - If both fail → Token/party issue

---

## Your Specific Case Analysis

### Current Token Analysis
```json
{
  "iss": "https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet",
  "aud": [
    "https://canton.network.global",
    "https://validator-wallet.tailb4f56.ts.net",
    "https://wallet.validator.dev.canton.wolfedgelabs.com",
    "account"
  ],
  "scope": "openid offline_access profile daml_ledger_api wallet_audience email",
  "sub": "8100b2db-86cf-40a1-8351-55483c151cdc"
}
```

### Findings
✅ **Has `daml_ledger_api` scope**
✅ **Has correct audience** (`https://canton.network.global`)
✅ **Has valid party ID** (`sub` claim)
❌ **Still returns 403** on query operations

### Most Likely Causes (Based on Documentation)

1. **Party Not Registered as Observer**
   - Party `8100b2db-86cf-40a1-8351-55483c151cdc` may not be registered
   - Or registered but not configured with observer permissions

2. **Keycloak Client Missing Query Permissions**
   - Client application may not have query permissions configured
   - Even with `daml_ledger_api` scope, query operations may be restricted

3. **Token Needs Explicit Read Scope**
   - May need `daml_ledger_api:read` in addition to `daml_ledger_api`

---

## Recommended Actions

### Immediate Actions
1. **Test Write Operation**
   ```bash
   # Try to create a contract
   # If this works, token has write permissions but not read
   ```

2. **Check Party Registration**
   - Ask client to verify party `8100b2db-86cf-40a1-8351-55483c151cdc` is registered
   - Verify party has observer permissions

3. **Request Token with Query Permissions**
   - Ask client to configure Keycloak client with query permissions
   - Request new token with explicit read permissions

### Long-term Solutions
1. **Separate Authentication Flows**
   - Use different tokens for read vs write operations
   - Or use a single token with both permissions

2. **Party Management**
   - Ensure all parties are properly registered
   - Configure observer permissions for query operations

3. **Token Validation**
   - Implement token validation before API calls
   - Check token scopes and permissions

---

## References

1. **Official Documentation**: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
2. **DAML Discuss**: https://discuss.daml.com/t/list-contracts-for-a-provider/8008
3. **Canton Documentation**: https://docs.digitalasset.com/canton/

---

## Conclusion

Based on deep documentation analysis:

**The 403 error is most likely due to:**
1. Party not registered as observer (most likely)
2. Keycloak client missing query permissions
3. Token needs explicit read scope

**Next Steps:**
1. Test write operation to confirm token works for commands
2. Verify party registration with client
3. Request token with explicit query permissions

