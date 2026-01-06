# Keycloak Password Grant Configuration

## Issue

Token generation is returning `null` because the Keycloak client doesn't support password grant.

## Solution

Enable "Direct Access Grants" (password grant) in your Keycloak client.

## Steps

### 1. Access Keycloak Admin Console

- URL: `https://keycloak.wolfedgelabs.com:8443`
- Username: `zoya`
- Password: `Zoya123!`
- Realm: `canton-devnet`

### 2. Navigate to Client Settings

1. Go to **Clients** in the left sidebar
2. Find and click on client: `Clob` (or your client ID)
3. Go to **Settings** tab

### 3. Enable Direct Access Grants

1. Scroll to **Access settings** section
2. Find **Direct access grants** toggle
3. **Enable** it (turn ON)
4. Click **Save**

### 4. Verify Client Authentication

Make sure:
- **Client authentication** is set appropriately
- If using confidential client, ensure client secret is configured
- If using public client, password grant should work without secret

### 5. Test

After enabling, test the party creation endpoint:

```bash
curl -X POST http://localhost:3001/api/create-party \
  -H "Content-Type: application/json" \
  -d '{
    "publicKeyHex": "122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"
  }'
```

**Expected:** Should return a token (not null)

## Alternative: Use Service Account

If password grant cannot be enabled, you can:

1. Create a service account for the client
2. Use client credentials grant
3. Configure protocol mapper to include party ID in token

But password grant is the recommended approach for this use case.

## Troubleshooting

### Error: "Password grant not supported"

**Solution:** Enable Direct Access Grants as described above.

### Error: "Invalid client credentials"

**Solution:** Check client secret if using confidential client.

### Error: "User not found"

**Solution:** Ensure Keycloak user creation is working. Check admin permissions.

## Verification

After configuration, the `/api/create-party` endpoint should:
- ✅ Create Keycloak user
- ✅ Generate JWT token (not null)
- ✅ Register party in Canton
- ✅ Return token in response

