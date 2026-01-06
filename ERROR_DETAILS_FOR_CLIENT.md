# Error Details for Client - Keycloak Configuration Issue

## The Error

When calling `/api/create-party`, the backend gets:

```
403 Forbidden - Service account lacks permission to create users
```

**Full error in backend logs:**
```
[PartyService] Error creating Keycloak user: Error: Failed to create user (403): {"error":"HTTP 403 Forbidden"}
```

## Root Cause

The "Clob" client needs **Service Accounts** enabled to create users programmatically. Currently:
- ✅ "Direct access grants" is enabled (confirmed)
- ❌ "Service accounts roles" is **NOT enabled** (this is the issue)

## Required Configuration

Based on your Keycloak UI screenshot, here's what needs to be changed:

### Step 1: Enable Service Accounts
1. Go to **Clients** → **"Clob"** → **Settings** tab
2. Find **"Capability config"** section
3. Under **"Authentication flow"**, check the box for **"Service accounts roles"**
4. Click **Save**

### Step 2: Assign manage-users Permission
1. Still in **"Clob"** client settings
2. Go to **"Service Account Roles"** tab (this appears after enabling Service Accounts)
3. Click **"Assign Role"**
4. In the dialog:
   - Select **"Filter by clients"**
   - Search for and select **"realm-management"**
5. In **Available Roles**, find and select:
   - **`manage-users`** (this allows creating/updating users)
6. Click **Assign**
7. Click **Save**

## Test After Configuration

After enabling Service Accounts, test the configuration:

```bash
GET http://localhost:3001/api/test-service-account
```

Expected success response:
```json
{
  "status": "success",
  "message": "Service Account is properly configured and has permissions",
  "canCreateUsers": true
}
```

## Why This Is Needed

The backend needs to:
1. Create a Keycloak user for each party (one user per wallet)
2. Generate a JWT token for that user via password grant
3. Return the token to the frontend

Without Service Accounts, the backend cannot create users (403 Forbidden), so tokens cannot be generated.

## Current Status

- ✅ Direct access grants: Enabled
- ❌ Service accounts roles: **NOT enabled** (needs to be checked)
- ❌ manage-users role: **NOT assigned** (needs to be assigned)

Once both are configured, the `/api/create-party` endpoint will work and return valid tokens.

