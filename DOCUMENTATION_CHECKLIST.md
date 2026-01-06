# Daml Enterprise Documentation Checklist

## What We Need to Verify in the Documentation

Based on the current implementation and client feedback, here's what we need to check in the Daml Enterprise 2.10.2 documentation:

### 1. External Party Registration

**Question:** How are external parties different from internal parties?

**What the client said:**
- "For creating external users I think right now it is only allowed by validator-operator user"
- "Service account roles will create a user, but that user only exists in keycloak and not in canton's participant so it wont help"

**What to check in docs:**
- [ ] What is an "external party" vs "internal party"?
- [ ] How to register external parties via API?
- [ ] What permissions are required for external party allocation?
- [ ] Is there a difference between Keycloak user creation and Canton party registration?

### 2. Canton Admin API Endpoints

**Current Issue:** Getting "Method Not Allowed" error when trying to register parties

**What to check in docs:**
- [ ] What is the correct HTTP endpoint for party allocation?
- [ ] What HTTP method should be used (POST, PUT, etc.)?
- [ ] What is the correct request format?
- [ ] What is the correct Content-Type header?
- [ ] Are there different endpoints for external vs internal parties?

**Client provided endpoints:**
- Admin API: `95.216.34.215:30100`
- Ledger API: `95.216.34.215:31217`
- JSON API: `95.216.34.215:31539`

**What to verify:**
- [ ] Which endpoint should be used for party allocation?
- [ ] What is the correct URL path (e.g., `/v1/parties/allocate`, `/parties/allocate`, etc.)?
- [ ] Is it HTTP REST or gRPC?

### 3. Validator-Operator Permissions

**What the client said:**
- "validator-app's clientId and clientSecret whose service account role is the validator-operator user"
- "this user has all the rights equivalent to admin access of our canton-devnet validator"

**What to check in docs:**
- [ ] What permissions does validator-operator have?
- [ ] Can validator-operator allocate external parties?
- [ ] How to verify validator-operator permissions in tokens?
- [ ] What scopes/claims should be in the token?

### 4. Party Allocation Process

**Current understanding:**
1. Generate party ID from public key (format: `prefix::hex(publicKey)`)
2. Register party in Canton (via Admin API)
3. Create Keycloak user
4. Generate JWT token

**What to check in docs:**
- [ ] Is this the correct order?
- [ ] Can we skip Canton registration if party already exists?
- [ ] What happens if party registration fails but Keycloak user is created?
- [ ] How to verify a party is registered?

### 5. Keycloak Service Account Configuration

**Current issue:** Service account lacks `manage-users` role

**What to check in docs:**
- [ ] Is `manage-users` role required for creating users?
- [ ] What other roles might be needed?
- [ ] Can we use validator-app for both Canton and Keycloak operations?
- [ ] Should we use different service accounts for different operations?

### 6. Token Generation

**What to check in docs:**
- [ ] What scopes are required for party allocation?
- [ ] What scopes are required for query operations?
- [ ] What scopes are required for command operations?
- [ ] How to include party ID in token claims?
- [ ] What is the correct audience (`aud`) claim?

### 7. Error Handling

**Current errors:**
- "Method Not Allowed" (405) - Canton party registration
- "Service account lacks manage-users role" - Keycloak user creation

**What to check in docs:**
- [ ] What do these errors mean?
- [ ] What are the correct error responses?
- [ ] How to handle party already exists?
- [ ] How to handle permission denied?

## Documentation Sections to Review

Based on typical Daml Enterprise documentation structure, check these sections:

1. **Party Management**
   - External vs Internal parties
   - Party allocation methods
   - Party registration process

2. **Admin API Reference**
   - HTTP endpoints
   - Request/response formats
   - Authentication requirements

3. **Keycloak Integration**
   - Service account setup
   - Required roles and permissions
   - Token generation

4. **Security & Permissions**
   - Validator-operator permissions
   - External party allocation permissions
   - Token scopes and claims

5. **Troubleshooting**
   - Common errors
   - Permission issues
   - API endpoint issues

## Next Steps

1. **Manual Review:** Open the PDF and search for:
   - "external party"
   - "party allocation"
   - "validator-operator"
   - "admin API"
   - "party registration"

2. **Verify Endpoints:** Check the Admin API section for:
   - Correct endpoint URLs
   - HTTP methods
   - Request formats

3. **Check Permissions:** Review security/permissions section for:
   - Required roles for party allocation
   - Required roles for user creation
   - Token requirements

4. **Update Implementation:** Based on findings, update:
   - `backend/canton-admin.js` - Correct endpoint and format
   - `backend/party-service.js` - Correct permissions and flow

## Current Implementation Status

✅ **Working:**
- Party ID generation from public key
- Keycloak service account authentication
- Token verification and permission checking
- Error messages with clear instructions

❌ **Not Working:**
- Canton party registration (Method Not Allowed error)
- Keycloak user creation (missing manage-users role)

🔍 **Needs Documentation Verification:**
- Correct Canton Admin API endpoint
- Correct request format
- Required permissions for external party allocation
- Whether external parties need different registration process

