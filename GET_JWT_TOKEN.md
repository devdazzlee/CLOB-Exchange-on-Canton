# 🔑 How to Get JWT Token

## Keycloak Credentials (From Deployment Instructions)

- **Keycloak URL:** https://keycloak.wolfedgelabs.com:8443
- **Username:** zoya
- **Password:** Zoya123!

---

## Method 1: Using Keycloak Web Interface

1. **Open Keycloak:**
   ```
   https://keycloak.wolfedgelabs.com:8443
   ```

2. **Login:**
   - Username: `zoya`
   - Password: `Zoya123!`

3. **Get Token:**
   - Navigate to your client/realm
   - Use Keycloak's token endpoint to get JWT

---

## Method 2: Using curl (Command Line)

```bash
# Get JWT token from Keycloak
curl -X POST "https://keycloak.wolfedgelabs.com:8443/realms/YOUR_REALM/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=zoya" \
  -d "password=Zoya123!" \
  -d "grant_type=password" \
  -d "client_id=YOUR_CLIENT_ID"
```

**Note:** You'll need to replace:
- `YOUR_REALM` with the actual realm name
- `YOUR_CLIENT_ID` with the actual client ID

---

## Method 3: Check if Token is Already Set

```bash
# Check if JWT_TOKEN environment variable exists
echo $JWT_TOKEN

# If empty, you need to get one
```

---

## Method 4: Contact API Administrator

If you don't have access to Keycloak or don't know the realm/client details:

1. Contact the Canton API administrator
2. Ask for:
   - JWT token (if they can provide one directly)
   - OR Keycloak realm name and client ID
   - OR Instructions for your specific setup

---

## After Getting Token

```bash
# Set the token as environment variable
export JWT_TOKEN="your-actual-jwt-token-here"

# Verify it's set
echo $JWT_TOKEN

# Then run deployment
./scripts/upload-dar-live.sh
```

---

## ⚠️ Important Notes

1. **Token Expiration:** JWT tokens expire. You may need to refresh periodically.
2. **Security:** Never commit tokens to git or share publicly.
3. **Testing:** Try deployment without token first - it might not be required.

