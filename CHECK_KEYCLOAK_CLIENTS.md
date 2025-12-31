# 🔍 How to Check Keycloak for JSON API Client

## What You're Looking For

You need to find a Keycloak **Client** (not Application) that has access to the JSON API.

---

## Step 1: Access Keycloak Admin Console

1. Go to: https://keycloak.wolfedgelabs.com:8443
2. Login with:
   - Username: `zoya`
   - Password: `Zoya123!`
3. Select realm: `canton-devnet` (if prompted)

---

## Step 2: Navigate to Clients Section

1. In the left sidebar, click **"Clients"** (not "Applications")
2. This shows all configured clients in the realm

---

## Step 3: Look For JSON API Client

Look for clients with names like:
- `json-api`
- `canton-json-api`
- `json-ledger-api`
- `canton-api`
- Or similar names

---

## Step 4: Check Client Details

If you find a JSON API client, check:
1. **Client ID** - Note this down
2. **Access Type** - Should be `confidential` or `public`
3. **Valid Redirect URIs** - Should include your frontend URL
4. **Service Accounts Enabled** - Check if enabled

---

## Step 5: Get Token for JSON API Client

If you find the client, you can get a token using:

```bash
curl -X POST "https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=zoya" \
  -d "password=Zoya123!" \
  -d "grant_type=password" \
  -d "client_id=CLIENT_ID_HERE" \
  -d "scope=openid"
```

Replace `CLIENT_ID_HERE` with the actual client ID.

---

## What I See in Your Screenshot

From your screenshot, I see:
- **Wallet Web UI** - Client ID: `4roh9X7y4TyT89feJu7AnM2sMZbR9xh7`
- **Account Console** - Client ID: `account-console`

These are **Applications** (what users see), not **Clients** (what developers configure).

---

## Next Steps

1. Go to Keycloak Admin Console
2. Click **"Clients"** in left sidebar
3. Look for JSON API related client
4. Share the Client ID with me
5. I'll help you get the correct token

---

## Alternative: Check if JSON API Doesn't Need Auth

If you can't find a JSON API client, it might mean:
- JSON API allows unauthenticated access
- Or authentication is handled differently

Let me know what you find!

