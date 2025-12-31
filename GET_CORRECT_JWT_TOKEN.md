# 🔑 How to Get Correct JWT Token for JSON API

## Problem
Current token has:
- Audience: `account` (Keycloak account management)
- Scopes: `openid profile email`
- ❌ NOT valid for JSON API endpoints

## Solution
Need a token with:
- Audience: `json-api` or `canton-json-api` (or similar)
- Scopes: Appropriate for JSON API access
- Resource access: JSON API resource

---

## Method 1: Contact API Administrator

Ask for:
1. **Correct Keycloak client ID** for JSON API
2. **Required scopes** for JSON API access
3. **How to obtain token** for JSON API

---

## Method 2: Try Different Keycloak Client

The token might need to come from a different Keycloak client:

```bash
# Try getting token with different client_id
curl -X POST "https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=zoya" \
  -d "password=Zoya123!" \
  -d "grant_type=password" \
  -d "client_id=json-api-client" \
  -d "scope=openid json-api"
```

**Note:** Replace `json-api-client` with the actual client ID for JSON API.

---

## Method 3: Check if JSON API Requires No Auth

Some JSON APIs allow unauthenticated queries. Test:

```bash
curl -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d '{"activeAtOffset":"0","filter":{"templateIds":["UserAccount:UserAccount"]}}'
```

If this works, we can remove authentication requirement.

---

## Method 4: Use Admin API Token

If the current token works for admin-api, you might need to:
1. Use admin-api for operations instead of json-api
2. Or get a token that works for both

---

## Current Token Info

- **Expires:** ~5 minutes from now
- **Audience:** `account` (wrong for JSON API)
- **Scopes:** `openid profile email` (basic scopes)
- **Status:** Valid but wrong permissions

---

## Next Steps

1. Contact Canton API administrator
2. Ask for JSON API authentication details
3. Get token with correct audience/scopes
4. Update `frontend/.env` with new token
5. Restart frontend

