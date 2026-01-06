# 🔧 Add Redirect URI to Keycloak - Step by Step

## Problem
Keycloak error: "Invalid parameter: redirect_uri"
The redirect URI `http://localhost:3000/auth/callback` is not registered.

## Solution: Add Redirect URI to Keycloak Client

### Step 1: Access Keycloak Admin Console
1. Open: **https://keycloak.wolfedgelabs.com:8443**
2. Click **Administration Console**
3. Login:
   - Username: `zoya`
   - Password: `Zoya123!`

### Step 2: Select Realm
1. In top-left dropdown, select: **canton-devnet**

### Step 3: Navigate to Client
1. In left sidebar, click **Clients**
2. Find and click: **4roh9X7y4TyT89feJu7AnM2sMZbR9xh7** (Wallet Web UI)

### Step 4: Add Redirect URI
1. Click **Settings** tab (if not already selected)
2. Scroll to **Valid redirect URIs** section
3. Click **Add valid redirect URI** button
4. Enter: `http://localhost:3000/auth/callback`
5. Click **Add** (or press Enter)
6. Scroll to bottom and click **Save**

### Step 5: Verify
After saving, the redirect URI should appear in the list.

### Step 6: Test
1. Refresh your browser
2. Try login again
3. Should work now! ✅

---

## Alternative: Use Different Redirect URI

If you can't modify Keycloak, check what redirect URIs are already configured:

1. In Keycloak Admin Console
2. Clients → 4roh9X7y4TyT89feJu7AnM2sMZbR9xh7 → Settings
3. Look at **Valid redirect URIs** list
4. Share one of those URIs with me
5. I'll update the code to use it

---

## Common Redirect URI Patterns

If you see patterns like these, let me know:
- `http://localhost:3000/*`
- `http://localhost:*/*`
- `https://wallet.validator.dev.canton.wolfedgelabs.com/*`
- Or any other pattern

I'll update the code to match!



