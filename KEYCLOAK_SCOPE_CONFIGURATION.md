# Keycloak Configuration Required: Add daml_ledger_api Scope

## 🚨 **Critical Issue**

The OAuth token is being issued **without** the `daml_ledger_api` scope, which is **required** for Canton API access. This is why you're getting 401 errors.

## Current Token Analysis

**Token Response:**
```json
{
  "scope": "openid profile email"  // ❌ Missing daml_ledger_api
}
```

**What We Need:**
```json
{
  "scope": "openid profile email daml_ledger_api"  // ✅ Required
}
```

## Root Cause

The Keycloak client "Clob" is not configured to allow the `daml_ledger_api` scope. Even though the frontend requests it, Keycloak filters it out because the client doesn't have access to it.

## Solution: Configure Keycloak Client

### Step 1: Check if Scope Exists

1. Login to Keycloak Admin Console: `https://keycloak.wolfedgelabs.com:8443`
2. Select realm: `canton-devnet`
3. Go to **Client Scopes** (left sidebar)
4. Check if `daml_ledger_api` scope exists

### Step 2A: If Scope Exists

1. Go to **Clients** → Select **"Clob"** client
2. Go to **Client Scopes** tab
3. Click **"Add client scope"**
4. Find `daml_ledger_api` in the list
5. Add it as **Optional** or **Default** client scope
6. Click **Save**

### Step 2B: If Scope Doesn't Exist - Create It

1. Go to **Client Scopes** (left sidebar)
2. Click **"Create client scope"**
3. Configure:
   - **Name**: `daml_ledger_api`
   - **Type**: Default
   - **Display on consent screen**: OFF
   - **Include in token scope**: ON
4. Click **Save**
5. Go to **Mappers** tab
6. Click **"Configure a new mapper"** → **"By configuration"**
7. Select **"Audience"** mapper
8. Configure:
   - **Name**: `daml-audience`
   - **Included Client Audience**: `https://canton.network.global`
9. Click **Save**
10. Go back to **Clients** → **"Clob"** → **Client Scopes**
11. Add the newly created `daml_ledger_api` scope

### Step 3: Verify Configuration

After configuration, test the OAuth flow:

1. Logout from the application
2. Login again
3. Check the token in browser console:
   ```javascript
   const token = localStorage.getItem('canton_jwt_token');
   const payload = JSON.parse(atob(token.split('.')[1]));
   console.log('Token scopes:', payload.scope);
   ```
4. Verify it includes `daml_ledger_api`

## Alternative: Use Protocol Mapper (If Scope Creation Doesn't Work)

If creating a scope doesn't work, you can use a Protocol Mapper to inject the scope:

1. Go to **Clients** → **"Clob"** → **Client Scopes** tab
2. Click **"Add client scope"** → **"Create client scope"**
3. Name: `daml_ledger_api`
4. Go to **Mappers** tab
5. Click **"Configure a new mapper"** → **"By configuration"**
6. Select **"Hardcoded claim"**
7. Configure:
   - **Name**: `daml-ledger-api-scope`
   - **Token Claim Name**: `scope`
   - **Claim value**: `daml_ledger_api`
   - **Add to access token**: ON
8. Click **Save**
9. Go back to **Clients** → **"Clob"** → **Client Scopes**
10. Add `daml_ledger_api` as Optional scope

## Verification

After configuration, the token should have:
```json
{
  "scope": "openid profile email daml_ledger_api",
  "aud": ["account", "https://canton.network.global"]
}
```

## Current Status

- ✅ Frontend code requests `daml_ledger_api` scope
- ✅ Proxy forwards token correctly
- ❌ Keycloak client not configured to grant `daml_ledger_api` scope
- ❌ Token missing required scope → 401 errors

## Next Steps

1. **Immediate**: Configure Keycloak client as described above
2. **After configuration**: Users need to logout and login again to get new token
3. **Verify**: Check token has `daml_ledger_api` scope
4. **Test**: API calls should work without 401 errors

## Code Changes Made

✅ Updated OAuth redirect flow to request `daml_ledger_api` scope
✅ Updated password grant flow to request `daml_ledger_api` scope  
✅ Added token validation to detect missing scope
✅ Enterprise API client with automatic retry

**The code is ready. Now Keycloak needs to be configured.**

