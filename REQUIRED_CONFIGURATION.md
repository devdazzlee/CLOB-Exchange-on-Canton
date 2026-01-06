# Required Keycloak Configuration - NO WORKAROUNDS

## The Problem

The backend **MUST** create users in Keycloak to generate proper JWT tokens for each party. There is **NO WORKAROUND** - we need admin permissions.

## The ONLY Solution

**Service Accounts** must be enabled for the "Clob" client. This is the production-ready approach.

## Configuration Steps (2 minutes)

1. **Keycloak Admin Console** → **Clients** → **"Clob"**
2. **Settings** tab → Enable **"Service Accounts Enabled"** → **Save**
3. **Service Account Roles** tab → Click **"Assign Role"**
4. Select **"realm-management"** client
5. Assign **"manage-users"** role → **Assign** → **Save**

## Test Configuration

After configuration, test it:

```bash
GET http://localhost:3001/api/test-service-account
```

Expected response:
```json
{
  "status": "success",
  "message": "Service Account is properly configured and has permissions",
  "canCreateUsers": true
}
```

## Why No Workarounds?

- ❌ **Static tokens** - Wrong party ID, Canton rejects them
- ❌ **Shared user account** - All parties would share same token (security issue)
- ❌ **User registration endpoint** - Can't set party attributes without admin API
- ✅ **Service Accounts** - ONLY way to create users programmatically

## Current Status

The code is ready. It will:
- ✅ Try to create users via Service Account
- ✅ Generate proper JWT tokens for each party
- ✅ Return clear error if Service Accounts not configured

**The endpoint will return proper tokens once Service Accounts are enabled.**

