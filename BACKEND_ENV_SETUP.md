# Backend Environment Variables Setup Guide

## Error Message

```
Party allocation failed: KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_CLIENT_SECRET must be configured for Canton party registration
```

## Problem

The backend server requires **Keycloak Admin Service Account** credentials to create parties for users. These environment variables are missing from your backend configuration.

## Required Environment Variables

You need to set these two environment variables in your backend:

1. **`KEYCLOAK_ADMIN_CLIENT_ID`** - A Keycloak client ID with service accounts enabled
2. **`KEYCLOAK_ADMIN_CLIENT_SECRET`** - The client secret for that service account

## Solution: Configure Environment Variables

### Option 1: Create `.env` file in `backend/` directory (Recommended for Local Development)

Create a file named `.env` in the `backend/` directory:

```bash
cd backend
touch .env
```

Add the following content to `backend/.env`:

```env
# Keycloak Admin Service Account (Required for party creation)
KEYCLOAK_ADMIN_CLIENT_ID=your-admin-client-id
KEYCLOAK_ADMIN_CLIENT_SECRET=your-admin-client-secret

# Optional: Override defaults if needed
KEYCLOAK_BASE_URL=https://keycloak.wolfedgelabs.com:8443
KEYCLOAK_REALM=canton-devnet
CANTON_ADMIN_BASE=https://participant.dev.canton.wolfedgelabs.com
CANTON_JSON_API_BASE=http://95.216.34.215:31539
```

**Important**: Replace `your-admin-client-id` and `your-admin-client-secret` with actual values from your Keycloak setup.

### Option 2: Set Environment Variables Directly (For Production/Deployment)

If deploying to a cloud service (like Vercel, Heroku, etc.), set these as environment variables in your deployment platform:

```bash
export KEYCLOAK_ADMIN_CLIENT_ID=your-admin-client-id
export KEYCLOAK_ADMIN_CLIENT_SECRET=your-admin-client-secret
```

Or in Windows Command Prompt:
```cmd
set KEYCLOAK_ADMIN_CLIENT_ID=your-admin-client-id
set KEYCLOAK_ADMIN_CLIENT_SECRET=your-admin-client-secret
```

Or in Windows PowerShell:
```powershell
$env:KEYCLOAK_ADMIN_CLIENT_ID="your-admin-client-id"
$env:KEYCLOAK_ADMIN_CLIENT_SECRET="your-admin-client-secret"
```

## How to Get Keycloak Admin Service Account Credentials

You need to create a Keycloak client with **Service Accounts** enabled. Here's how:

### Step 1: Create or Use an Existing Keycloak Client

1. **Login to Keycloak Admin Console**
   - URL: `https://keycloak.wolfedgelabs.com:8443`
   - Realm: `canton-devnet`
   - Login with admin credentials

2. **Navigate to Clients**
   - Go to **Clients** in the left sidebar
   - Click **Create client** (or use existing client)

3. **Configure Client**
   - **Client ID**: Choose a name (e.g., `clob-admin-service`, `canton-party-service`)
   - **Client authentication**: **ON** (this enables service accounts)
   - **Authorization**: Optional
   - Click **Next**

4. **Configure Capabilities**
   - **Standard flow**: OFF (not needed for service accounts)
   - **Direct access grants**: OFF (not needed)
   - **Service accounts roles**: **ON** ✅ (REQUIRED)
   - Click **Next**, then **Save**

5. **Get Client Secret**
   - After saving, go to the **Credentials** tab
   - Copy the **Client secret** value
   - This is your `KEYCLOAK_ADMIN_CLIENT_SECRET`

6. **Assign Required Roles**
   - Go to **Service account roles** tab
   - Click **Assign role**
   - Filter by clients: Select **realm-management**
   - Assign role: **manage-users** ✅ (REQUIRED)
   - Click **Assign**

### Step 2: Use the Credentials

Now you have:
- **Client ID**: The client ID you chose (e.g., `clob-admin-service`)
- **Client Secret**: The secret from the Credentials tab

Add these to your `.env` file:

```env
KEYCLOAK_ADMIN_CLIENT_ID=clob-admin-service
KEYCLOAK_ADMIN_CLIENT_SECRET=your-copied-secret-here
```

## Verify Configuration

### 1. Check Environment Variables are Loaded

The backend uses `dotenv` package to load `.env` files. Make sure:

1. `backend/package.json` includes `dotenv` (✅ already present)
2. `backend/server.js` loads dotenv at the top:

```javascript
require('dotenv').config();
```

If `server.js` doesn't have this, add it at the very top of the file.

### 2. Restart Backend Server

After setting environment variables:

```bash
cd backend
# Stop the current server (Ctrl+C if running)
# Start it again
npm start
# or
node server.js
```

### 3. Test Party Creation

Try creating a party from the frontend. The error should be resolved if configuration is correct.

## Troubleshooting

### Error: "KEYCLOAK_ADMIN_CLIENT_ID not configured"

**Cause**: Environment variable not set or `.env` file not loaded.

**Solutions**:
1. Check that `.env` file exists in `backend/` directory
2. Verify `require('dotenv').config()` is at the top of `server.js`
3. Restart the backend server after creating `.env`
4. Check for typos in variable names (must be exact: `KEYCLOAK_ADMIN_CLIENT_ID`)

### Error: "Service account authentication failed"

**Cause**: Invalid client ID or secret, or service accounts not enabled.

**Solutions**:
1. Verify client ID is correct in Keycloak
2. Verify client secret is correct (copy again from Credentials tab)
3. Ensure **Service accounts roles** is enabled in client configuration
4. Check that client authentication is ON

### Error: "Service account lacks 'manage-users' role"

**Cause**: Service account doesn't have required permissions.

**Solutions**:
1. Go to Keycloak → Clients → Your Client → **Service account roles**
2. Click **Assign role**
3. Filter by clients: Select **realm-management**
4. Assign role: **manage-users**
5. Save and restart backend

### Error: "Party allocation failed: ..."

**Cause**: Multiple possible issues after Keycloak authentication succeeds.

**Solutions**:
1. Check Keycloak admin token is being generated successfully (check backend logs)
2. Verify Canton API endpoints are accessible
3. Check network connectivity to Canton services
4. Verify party registration quota limits

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `KEYCLOAK_ADMIN_CLIENT_ID` | Keycloak client ID with service accounts | `clob-admin-service` |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Secret for the service account client | `abc123...xyz` |

### Optional Variables (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYCLOAK_BASE_URL` | `https://keycloak.wolfedgelabs.com:8443` | Keycloak server URL |
| `KEYCLOAK_REALM` | `canton-devnet` | Keycloak realm name |
| `CANTON_ADMIN_BASE` | `https://participant.dev.canton.wolfedgelabs.com` | Canton admin API base URL |
| `CANTON_JSON_API_BASE` | `http://95.216.34.215:31539` | Canton JSON API base URL |
| `DAILY_PARTY_QUOTA` | `5000` | Daily party creation limit |
| `WEEKLY_PARTY_QUOTA` | `35000` | Weekly party creation limit |

## Security Notes

⚠️ **IMPORTANT SECURITY CONSIDERATIONS**:

1. **Never commit `.env` files to Git**
   - Add `backend/.env` to `.gitignore`
   - These secrets should only exist in your local environment and secure deployment platforms

2. **Use Environment Variables in Production**
   - Don't hardcode secrets in code
   - Use platform-specific secret management (Vercel Environment Variables, AWS Secrets Manager, etc.)

3. **Rotate Secrets Regularly**
   - Change client secrets periodically
   - Revoke old secrets when rotating

4. **Limit Service Account Permissions**
   - Only assign the minimum required roles (`manage-users`)
   - Don't grant unnecessary admin permissions

## Example `.env` File Template

```env
# Keycloak Configuration
KEYCLOAK_BASE_URL=https://keycloak.wolfedgelabs.com:8443
KEYCLOAK_REALM=canton-devnet

# Keycloak Admin Service Account (REQUIRED)
KEYCLOAK_ADMIN_CLIENT_ID=clob-admin-service
KEYCLOAK_ADMIN_CLIENT_SECRET=your-secret-here-change-this

# Canton Configuration
CANTON_ADMIN_BASE=https://participant.dev.canton.wolfedgelabs.com
CANTON_ADMIN_HOST=95.216.34.215
CANTON_ADMIN_PORT=30100
CANTON_JSON_API_BASE=http://95.216.34.215:31539

# Quota Limits (Optional)
DAILY_PARTY_QUOTA=5000
WEEKLY_PARTY_QUOTA=35000

# Server Configuration (Optional)
PORT=3001
NODE_ENV=development
```

## Next Steps

1. ✅ Create Keycloak client with service accounts enabled
2. ✅ Assign `manage-users` role to service account
3. ✅ Create `backend/.env` file with credentials
4. ✅ Verify `dotenv` is loaded in `server.js`
5. ✅ Restart backend server
6. ✅ Test party creation endpoint
7. ✅ Verify no errors in backend logs

After completing these steps, the `/api/create-party` endpoint should work correctly!

