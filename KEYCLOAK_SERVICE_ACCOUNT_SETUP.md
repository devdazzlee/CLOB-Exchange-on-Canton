# Keycloak Service Account Setup - REQUIRED

## Problem
The backend is getting `403 Forbidden` when trying to create users because the `zoya` user account doesn't have admin permissions.

## Solution
We've switched to using **Service Accounts** instead of user accounts. This is the proper, production-ready approach.

## Required Keycloak Configuration

### Step 1: Enable Service Accounts for "Clob" Client

1. Log in to Keycloak Admin Console
2. Go to **Clients** → Select **"Clob"** client
3. Go to **Settings** tab
4. Find **"Service Accounts Enabled"** and set it to **ON**
5. Click **Save**

### Step 2: Assign manage-users Role to Service Account

1. While still in the **"Clob"** client settings
2. Go to the **"Service Account Roles"** tab (this tab appears after enabling Service Accounts)
3. Click **"Assign Role"**
4. In the dialog:
   - Select **"Filter by clients"**
   - Search for and select **"realm-management"**
5. In the **Available Roles** list, find and select:
   - **`manage-users`** (this allows creating/updating users)
6. Click **Assign**
7. Click **Save**

### Step 3: Verify Client Secret

1. In the **"Clob"** client **Settings** tab
2. Check **"Access Type"**:
   - If it's **"confidential"**: You need a client secret
   - If it's **"public"**: No client secret needed
3. If **confidential**, go to **"Credentials"** tab and copy the **"Client Secret"**
4. Set this in your backend `.env` file as `KEYCLOAK_CLIENT_SECRET`

## Backend Environment Variables

Make sure your backend has these set:

```env
KEYCLOAK_BASE_URL=https://keycloak.wolfedgelabs.com:8443
KEYCLOAK_REALM=canton-devnet
KEYCLOAK_CLIENT_ID=Clob
KEYCLOAK_CLIENT_SECRET=<your-client-secret-if-confidential>
```

**Note:** You no longer need `KEYCLOAK_ADMIN_USER` or `KEYCLOAK_ADMIN_PASSWORD` - we're using service accounts now.

## Testing

After configuration, restart your backend and try creating a party. The 403 error should be resolved.

## Why This is Better

- ✅ **No user account needed** - uses the client's own credentials
- ✅ **Proper permissions** - service account has exactly the permissions it needs
- ✅ **More secure** - no user password stored in backend
- ✅ **Production-ready** - this is the recommended approach for server-to-server operations

