# 🔧 Keycloak Redirect URI Configuration

## Problem
Keycloak is rejecting the redirect URI: `http://localhost:3000/auth/callback`

## Solution
You need to add this redirect URI to your Keycloak client configuration.

## Steps to Fix

### 1. Access Keycloak Admin Console
- URL: `https://keycloak.wolfedgelabs.com:8443`
- Username: `zoya`
- Password: `Zoya123!`
- Realm: `canton-devnet`

### 2. Navigate to Client Configuration
1. Go to **Clients** in left sidebar
2. Find client: `4roh9X7y4TyT89feJu7AnM2sMZbR9xh7` (Wallet Web UI)
3. Click on the client name

### 3. Add Redirect URI
1. Scroll to **Valid redirect URIs** section
2. Click **Add valid redirect URI**
3. Add: `http://localhost:3000/auth/callback`
4. Also add (for production): `https://your-domain.com/auth/callback`
5. Click **Save**

### 4. Alternative: Use Wildcard Pattern
If you want to allow all localhost ports:
- Add: `http://localhost:*/auth/callback`

Or for all origins:
- Add: `http://localhost:*/**`

## Quick Fix: Use Existing Redirect URI

If you can't modify Keycloak, check what redirect URIs are already configured and use one of those. Common patterns:
- `http://localhost:3000/*`
- `https://wallet.validator.dev.canton.wolfedgelabs.com/*`
- `http://localhost:*/*`

## After Configuration

Once the redirect URI is added:
1. Refresh your browser
2. Try login again
3. It should work!


