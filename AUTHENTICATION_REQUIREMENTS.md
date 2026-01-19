# Authentication Requirements for DAR Upload

## Current Issue

The `upload-dar-direct.sh` script is failing with:
```
{"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"}
```

## What I Need From You

To fix the authentication, I need **ONE** of the following:

### Option 1: Backend Environment Variables (RECOMMENDED)

If your backend has a `.env` file with working credentials, provide:

1. **KEYCLOAK_ADMIN_CLIENT_ID** - The client ID that works for admin operations
2. **KEYCLOAK_ADMIN_CLIENT_SECRET** - The corresponding client secret

**OR** just tell me if these are already set in `backend/.env` and I'll update the script to use them.

### Option 2: Working Client Credentials

If you have different client credentials that work for `client_credentials` flow:

1. **Client ID** - The correct client ID
2. **Client Secret** - The correct client secret
3. **Keycloak URL** - (if different from current)
4. **Realm** - (if different from `canton-devnet`)

### Option 3: Use Backend Service (EASIEST - Already Created!)

I've created `upload-dar-via-backend.sh` which uses your backend's working admin service.

**Just ensure your `backend/.env` has:**
```bash
KEYCLOAK_ADMIN_CLIENT_ID=your_working_client_id
KEYCLOAK_ADMIN_CLIENT_SECRET=your_working_client_secret
```

Then run:
```bash
./upload-dar-via-backend.sh
```

## What to Check in Keycloak

If the credentials should work but don't, verify in Keycloak Admin Console:

1. **Client exists** - Go to Clients → Find your client ID
2. **Service Account enabled** - Client Settings → "Service accounts enabled" = ON
3. **Client credentials grant** - Client Settings → "Client authentication" = ON
4. **Scope assigned** - Service Account Roles → Ensure `daml_ledger_api` scope is available
5. **Client secret correct** - Credentials tab → Copy the exact secret

## Quick Test

You can test if credentials work by running:

```bash
curl -k -X POST https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "scope=daml_ledger_api"
```

If this returns an `access_token`, the credentials are correct!

## Recommended Solution

**Use `upload-dar-via-backend.sh`** - It uses the same authentication method as your backend, which is already working!
