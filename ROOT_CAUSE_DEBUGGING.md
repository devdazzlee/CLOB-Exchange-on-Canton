# Root Cause Debugging Guide

## Problem
Backend is returning `token: null` in the `/api/create-party` response, and frontend Canton API calls are resulting in `401 Unauthorized` errors, despite "Direct access grants" being enabled in Keycloak.

## Recent Fixes Applied

1. **Enhanced Error Handling**: Added comprehensive error handling and validation throughout the token generation flow
2. **Improved Logging**: Added detailed logging at every step to track exactly where failures occur
3. **Response Validation**: Added multiple validation checks to ensure token is never null
4. **Better Error Messages**: Added specific error messages for different failure scenarios

## Debugging Steps

### Step 1: Check Backend Logs

When calling `/api/create-party`, check the backend console logs. You should see detailed logs like:

```
[PartyService] Creating party: ...
[PartyService] Registering party in Canton...
[PartyService] Creating Keycloak user...
[PartyService] Generating JWT token...
[PartyService] Requesting token from: ...
[PartyService] Token response status: ...
```

**Look for:**
- Any errors in the logs
- The exact status code from Keycloak
- The response body from Keycloak
- Whether the token is being generated but then lost

### Step 2: Test Password Grant Manually

Use the debug script to test the password grant directly:

```bash
cd backend
node debug-password-grant.js <username> <password>
```

Replace `<username>` and `<password>` with a Keycloak user that was created by the system (e.g., `party_1234567890abcdef` and the generated password).

**What to check:**
- Does the request succeed (status 200)?
- Does the response contain `access_token`?
- What is the exact error message if it fails?

### Step 3: Verify Keycloak Configuration

1. **Client Configuration:**
   - Go to Keycloak Admin Console
   - Navigate to: Clients → `Clob` (or your client ID)
   - Check "Settings" tab:
     - **Access Type**: Should be "public" OR "confidential"
     - **Direct Access Grants Enabled**: Must be ON (enabled)
     - **Valid Redirect URIs**: Should include your backend URL
   
2. **If Client is Confidential:**
   - Go to "Credentials" tab
   - Copy the "Client Secret"
   - Set environment variable: `KEYCLOAK_CLIENT_SECRET=<secret>`

3. **User Permissions:**
   - Verify the created user exists in Keycloak
   - Check if user is enabled
   - Verify user password is set correctly

### Step 4: Test with cURL

Test the password grant directly with cURL:

```bash
curl -X POST "https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=Clob" \
  -d "username=party_1234567890abcdef" \
  -d "password=<generated_password>" \
  -d "scope=openid profile email daml_ledger_api"
```

**If client is confidential, add:**
```bash
  -d "client_secret=<client_secret>"
```

**What to check:**
- Response status code
- Response body (should contain `access_token`)
- Any error messages

### Step 5: Check Environment Variables

Verify all required environment variables are set:

```bash
echo $KEYCLOAK_BASE_URL
echo $KEYCLOAK_REALM
echo $KEYCLOAK_CLIENT_ID
echo $KEYCLOAK_CLIENT_SECRET  # May be empty if public client
echo $KEYCLOAK_ADMIN_USER
echo $KEYCLOAK_ADMIN_PASSWORD
```

### Step 6: Verify Admin Permissions

The `zoya` account needs admin permissions to create users. Check:

1. Go to Keycloak Admin Console
2. Navigate to: Users → `zoya`
3. Check "Role Mappings" tab
4. Verify user has `realm-admin` role or equivalent admin permissions

If not, add the role:
- Go to "Role Mappings" → "Assign Role"
- Select "Filter by clients" → "realm-management"
- Assign "realm-admin" role

## Common Issues and Solutions

### Issue 1: "unauthorized_client" Error

**Symptom:** Keycloak returns `400 Bad Request` with error `unauthorized_client`

**Solution:**
- Enable "Direct Access Grants" in Keycloak client settings
- Verify client ID is correct
- Check if client is public or confidential (and set secret if confidential)

### Issue 2: "invalid_grant" Error

**Symptom:** Keycloak returns `401 Unauthorized` with error `invalid_grant`

**Solution:**
- Verify user exists in Keycloak
- Check user password is correct
- Ensure user is enabled
- Verify user is not locked or expired

### Issue 3: "invalid_client" Error

**Symptom:** Keycloak returns `400 Bad Request` with error `invalid_client`

**Solution:**
- Verify client ID is correct
- Check if client exists in the realm
- If client is confidential, verify client secret is correct

### Issue 4: Token is Generated but Returns Null

**Symptom:** Logs show token is generated, but API response has `token: null`

**Solution:**
- Check for any error handling that might be catching exceptions
- Verify the token is not being modified after generation
- Check if there's a serialization issue (token should be a string)

### Issue 5: Admin Token Generation Fails

**Symptom:** Logs show "Failed to get admin token"

**Solution:**
- Verify `KEYCLOAK_ADMIN_USER` and `KEYCLOAK_ADMIN_PASSWORD` are correct
- Check if admin user has proper permissions
- Try using `admin-cli` client or the application client

## Expected Log Flow

When party creation succeeds, you should see:

```
[PartyService] Creating party: 8100b2db-86cf-40a1-8351-55483c151cdc::...
[PartyService] Registering party in Canton...
[PartyService] Party registered in Canton via http
[PartyService] Creating Keycloak user...
[PartyService] Keycloak user created: party_...
[PartyService] Generating JWT token...
[PartyService] Requesting token from: https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token
[PartyService] Token response status: 200 OK
[PartyService] Token response body length: ...
[PartyService] Token generated successfully via password grant, length: ...
[PartyService] JWT token generated successfully, length: ...
[API] Party creation completed successfully
[API] Token generated, length: ...
```

## Next Steps

1. **Run the debug script** with a known username/password
2. **Check backend logs** when calling `/api/create-party`
3. **Test with cURL** to isolate the issue
4. **Verify Keycloak configuration** matches requirements
5. **Share the results** so we can identify the exact root cause

## Contact Information

If the issue persists after following these steps, please provide:
1. Complete backend logs from a party creation attempt
2. Output from the debug script
3. cURL test results
4. Keycloak client configuration (screenshot or export)
5. Environment variables (without sensitive values)

