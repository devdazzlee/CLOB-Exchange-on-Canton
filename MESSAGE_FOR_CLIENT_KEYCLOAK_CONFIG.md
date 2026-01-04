# Message for Client: Keycloak Configuration Needed

---

**Hey Huzefa,**

Thanks for creating the "Clob" client and confirming the ledger permissions! The user has both `actAs` and `readAs` permissions on the Canton ledger, which is perfect.

However, there's one more configuration needed in Keycloak to fix the 401 errors:

## Issue: Missing `daml_ledger_api` Scope in Token

The OAuth token is being issued **without** the `daml_ledger_api` scope, which Canton API requires. Even though the frontend requests it, Keycloak is filtering it out.

**Current token scope:** `"openid profile email"` ❌  
**Required scope:** `"openid profile email daml_ledger_api"` ✅

## Quick Fix: Add Client Scope to "Clob" Client

### Option 1: If `daml_ledger_api` scope already exists in Keycloak

1. Go to Keycloak Admin Console: `https://keycloak.wolfedgelabs.com:8443`
2. Select realm: `canton-devnet`
3. Go to **Clients** → Select **"Clob"** client
4. Go to **Client Scopes** tab
5. Click **"Add client scope"**
6. Find `daml_ledger_api` in the list
7. Add it as **Optional** client scope
8. Click **Save**

### Option 2: If scope doesn't exist - Create it

1. Go to **Client Scopes** (left sidebar in Keycloak)
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
11. Add `daml_ledger_api` as **Optional** scope

## Verification

After configuration:
1. User needs to logout and login again
2. Check token in browser console:
   ```javascript
   const token = localStorage.getItem('canton_jwt_token');
   const payload = JSON.parse(atob(token.split('.')[1]));
   console.log('Token scopes:', payload.scope);
   ```
3. Should show: `"openid profile email daml_ledger_api"`

## Current Status

- ✅ Ledger permissions: User has `actAs` and `readAs` 
- ✅ Client created: "Clob" with redirect URI
- ✅ Frontend code: Requests `daml_ledger_api` scope
- ❌ Keycloak config: Client doesn't grant `daml_ledger_api` scope
- ❌ Result: 401 errors on Canton API calls

Once the scope is added to the client, the 401 errors will be resolved!

Thanks!  
Zoya

---

