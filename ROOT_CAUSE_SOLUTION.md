# 🔍 ROOT CAUSE & SOLUTION: Keycloak Redirect URI

## Root Cause Analysis

**Problem:** Keycloak rejects `redirect_uri` with "Invalid parameter: redirect_uri"

**Root Cause:** 
The redirect URI `http://localhost:3000/auth/callback` is **NOT registered** in the Keycloak client's "Valid Redirect URIs" configuration.

**Why This Happens:**
- Keycloak requires **EXACT match** between the redirect_uri in the OAuth request and the URIs configured in the client
- No wildcards are supported (contrary to some documentation)
- The client `4roh9X7y4TyT89feJu7AnM2sMZbR9xh7` doesn't have this redirect URI configured

## Solution Options

### Option 1: Add Redirect URI Programmatically (RECOMMENDED)

Run the automated script:

```bash
bash scripts/add-keycloak-redirect-uri.sh
```

This script:
1. Authenticates with Keycloak Admin API
2. Finds the client configuration
3. Checks existing redirect URIs
4. Adds `http://localhost:3000/auth/callback` if not present
5. Updates the client configuration

### Option 2: Add Redirect URI Manually

1. Go to: https://keycloak.wolfedgelabs.com:8443
2. Login: `zoya` / `Zoya123!`
3. Realm: `canton-devnet`
4. Clients → `4roh9X7y4TyT89feJu7AnM2sMZbR9xh7`
5. Settings → Valid redirect URIs
6. Add: `http://localhost:3000/auth/callback`
7. Save

### Option 3: Use Existing Redirect URI

If you can't modify Keycloak, check what redirect URIs are already configured:

1. Run: `bash scripts/add-keycloak-redirect-uri.sh` (it will show existing URIs)
2. Share one of the existing URIs with me
3. I'll update the code to use that URI instead

## Technical Details

**Keycloak Documentation:**
- Redirect URIs must match EXACTLY (scheme, host, port, path)
- Case-sensitive comparison
- No wildcard support in redirect URIs (only in web origins)
- Required for OAuth 2.0 Authorization Code flow with PKCE

**OAuth 2.0 Specification:**
- Redirect URI is a security measure to prevent redirect attacks
- Must be pre-registered in the authorization server (Keycloak)
- Cannot be dynamically added during the flow

## Verification

After adding the redirect URI:
1. Refresh browser
2. Try OAuth login
3. Should redirect successfully to `/auth/callback`
4. Token exchange should complete

## Why This Is The Root Cause

This is NOT a code issue - it's a **Keycloak configuration issue**. The code is correct, but Keycloak needs to know which redirect URIs are allowed for security reasons. This is standard OAuth 2.0 security practice.


