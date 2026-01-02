# UPDATED: Keycloak Configuration Issues Found

## 🚨 **TWO ISSUES NEED FIXING**

The OAuth login is failing on production with **scope errors**. Your client needs to fix two things in Keycloak:

---

**Hey ZOYA MUHAMMAD,**

I found two issues with the "Clob" client configuration in Keycloak:

## Issue 1: Missing Scopes (URGENT)
**Error:** `invalid_scope` for `daml_ledger_api` and `wallet_audience`

**Fix Required:** Add these scopes to the "Clob" client:
1. Go to Keycloak Admin Console
2. Navigate to "canton-devnet" realm
3. Select "Clob" client
4. Go to "Client Scopes" tab
5. Add these **Optional Client Scopes**:
   - `daml_ledger_api`
   - `wallet_audience`

## Issue 2: Local Development Redirect URI
**Error:** `Invalid parameter: redirect_uri` for localhost

**Fix Required:** Add this redirect URI:
```
http://localhost:3000/auth/callback
```

## Complete Steps to Fix Both Issues:

### Step 1: Add Client Scopes
1. Login to Keycloak Admin Console
2. Go to "canton-devnet" realm
3. Select "Clob" client
4. Click "Client Scopes" tab
5. Click "Add client scope" (or assign existing scopes)
6. Add: `daml_ledger_api` (if exists) or create it
7. Add: `wallet_audience` (if exists) or create it
8. Set them as "Optional"

### Step 2: Add Local Redirect URI
1. Stay in "Clob" client configuration
2. Go to "Settings" tab
3. In "Valid Redirect URIs" section, add:
   - `http://localhost:3000/auth/callback`
   - `https://clob-exchange-on-canton.vercel.app/auth/callback` (already there)
4. Click "Save"

## What I Changed:
- Temporarily reduced OAuth scopes to standard ones (`openid profile email`)
- This will work immediately but may lack some Canton-specific functionality

## Current Status:
- ✅ Basic OAuth will work with standard scopes
- ❌ Canton-specific scopes need to be configured in Keycloak
- ❌ Local development needs redirect URI

## Timeline:
- **Immediate:** OAuth works with basic scopes
- **After scope fix:** Full OAuth functionality with Canton features
- **After redirect URI fix:** Local development works

Please configure both the client scopes and redirect URI as soon as possible.

Thanks,
Zoya

---

## 🎯 **Technical Details**

**Current Error URL:**
```
https://clob-exchange.on-canton.vercel.app/auth/callback?error=invalid_scope&error_description=Invalid+scopes%3A+openid+profile+email+daml_ledger_api+wallet_audience
```

**What This Means:**
Keycloak doesn't recognize `daml_ledger_api` and `wallet_audience` as valid scopes for the "Clob" client.

**Solution:**
Either add these scopes to Keycloak or use only standard OAuth scopes (which I've temporarily implemented).

## 🚀 **Immediate Fix Applied**
I've updated the OAuth request to use only standard scopes (`openid profile email`) so the basic login will work immediately. The Canton-specific functionality may be limited until the proper scopes are configured.
