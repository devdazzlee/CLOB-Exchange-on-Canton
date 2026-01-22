# OAuth Token Acquisition Fix ✅

## Problem
The `/api/onboarding/allocate-party` endpoint was failing with "Invalid URL" error during OAuth token acquisition.

## Root Causes
1. **Environment variables not properly loaded** - Missing or incorrectly named env vars
2. **Smart quotes in URL** - Copy/paste introduced curly quotes `""` instead of normal quotes
3. **URL validation issues** - No proper cleaning/validation of URL strings
4. **Missing TLS configuration** - Dev environment needs insecure TLS support (like curl -k)

## Solution Applied

### 1. Enhanced OAuth Service (`apps/api/src/services/oauth.ts`)

**Features Added**:
- ✅ `cleanEnvUrl()` function that:
  - Trims whitespace
  - Removes surrounding quotes (normal and smart quotes)
  - Detects and warns about smart quotes
  - Validates URL format with `new URL()`
- ✅ Proper error messages for missing env vars
- ✅ Token caching (expires 30s before actual expiry)
- ✅ Insecure TLS support for dev (`CANTON_OAUTH_INSECURE_TLS=true`)
- ✅ Uses undici fetch for better Node.js support
- ✅ Detailed error logging

**Environment Variables**:
- `CANTON_OAUTH_TOKEN_URL` - Token endpoint URL (NO quotes)
- `CANTON_OAUTH_CLIENT_ID` - Client ID
- `CANTON_OAUTH_CLIENT_SECRET` - Client secret
- `CANTON_OAUTH_INSECURE_TLS` - Set to `true` for dev (disables cert validation)

### 2. Updated Configuration (`apps/api/src/config.ts`)

- ✅ Changed env var names to `CANTON_OAUTH_*` pattern
- ✅ Added `insecureTls` config option

### 3. Enhanced Error Handling (`apps/api/src/routes/onboarding.ts`)

- ✅ More detailed error messages
- ✅ OAuth-specific error detection and guidance
- ✅ Development mode stack traces

### 4. Created `.env.example`

- ✅ Documents all required OAuth env vars
- ✅ Shows correct format (no quotes)
- ✅ Includes insecure TLS option for dev

### 5. Created Test Script (`apps/api/src/utils/clean-env-url.test.ts`)

- ✅ Tests normal URL
- ✅ Tests URL wrapped in quotes
- ✅ Tests URL with smart quotes
- ✅ Tests URL with whitespace
- ✅ Tests invalid URLs

## Setup Instructions

### 1. Create `.env` file in `apps/api/`

```env
CANTON_OAUTH_TOKEN_URL=https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token
CANTON_OAUTH_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw
CANTON_OAUTH_CLIENT_SECRET=your-secret-here
CANTON_OAUTH_INSECURE_TLS=true
```

**Important**:
- ❌ NO quotes around values
- ❌ NO smart quotes `""`
- ✅ Plain ASCII characters only
- ✅ No trailing whitespace

### 2. Test the Fix

```bash
# Run the test script
cd apps/api
tsx src/utils/clean-env-url.test.ts

# Start the server
yarn dev

# Test the endpoint
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"test"}'
```

## Verification

After setup, the OAuth service should:
1. ✅ Successfully clean and validate the token URL
2. ✅ Acquire OAuth token from Keycloak
3. ✅ Cache token until expiry
4. ✅ Handle TLS certificate issues in dev mode
5. ✅ Provide clear error messages if configuration is wrong

## Common Issues

### "Missing env CANTON_OAUTH_TOKEN_URL"
- Check `.env` file exists in `apps/api/`
- Verify variable name is exactly `CANTON_OAUTH_TOKEN_URL`
- Restart dev server after changing `.env`

### "URL contains smart quotes"
- Copy the URL again, ensuring no curly quotes
- Manually type the URL if needed
- Check `.env` file in a plain text editor

### "Invalid URL format"
- Ensure URL starts with `https://`
- Check for extra characters or whitespace
- Verify no quotes in the value

### Certificate errors
- Set `CANTON_OAUTH_INSECURE_TLS=true` for dev
- Never use insecure TLS in production

## Status

✅ OAuth service fixed
✅ URL cleaning and validation implemented
✅ Insecure TLS support added
✅ Error handling enhanced
✅ Documentation created
✅ Test script created

The `/api/onboarding/allocate-party` endpoint should now successfully acquire OAuth tokens!
