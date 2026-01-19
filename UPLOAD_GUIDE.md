# DAR Upload Guide - Multiple Methods

## 🎯 Quick Start (Recommended)

**Use Password Grant (easiest):**
```bash
./upload-dar-password-grant.sh
```

This script uses your credentials (zoya/Zoya123!) and automatically tries different client IDs to get a token with `daml_ledger_api` scope.

---

## 📋 Available Upload Methods

### Method 1: Password Grant ⭐ RECOMMENDED
**Script:** `upload-dar-password-grant.sh`

**What it does:**
- Uses username/password to get a fresh token
- Automatically requests `daml_ledger_api` scope
- Tries multiple client IDs to find one that works
- Uploads the DAR file

**Usage:**
```bash
./upload-dar-password-grant.sh
```

**Credentials used:**
- Username: `zoya`
- Password: `Zoya123!`
- Client IDs tried: `Clob`, `account-console`, `canton-client`

---

### Method 2: Use Provided Token
**Script:** `upload-dar-with-token.sh`

**What it does:**
- Uses a pre-obtained JWT token
- Validates token expiration and scopes
- Uploads the DAR file

**Usage:**
```bash
# Option A: Token is already in the script
./upload-dar-with-token.sh

# Option B: Provide token via environment variable
export JWT_TOKEN='your-token-here'
./upload-dar-with-token.sh
```

**⚠️ Important:** Your provided token only has `openid profile email` scope. It's missing `daml_ledger_api` scope, so the upload will likely fail with 403 Forbidden.

**Solution:** Use Method 1 (Password Grant) instead, which requests the correct scope.

---

### Method 3: Backend Admin Service
**Script:** `upload-dar-via-backend.sh`

**What it does:**
- Uses your backend's `CantonAdmin` service
- Gets token using backend's configured credentials
- Uploads the DAR file

**Usage:**
```bash
# Ensure backend/.env has:
# KEYCLOAK_ADMIN_CLIENT_ID=your_client_id
# KEYCLOAK_ADMIN_CLIENT_SECRET=your_client_secret

./upload-dar-via-backend.sh
```

---

### Method 4: Complete Deployment
**Script:** `deployment/deployment.sh`

**What it does:**
- Builds DAML contracts
- Prompts for authentication method
- Uploads DAR
- Verifies deployment

**Usage:**
```bash
./deployment/deployment.sh
```

---

## 🔍 Token Scope Requirements

For DAR uploads to work, your token **MUST** have:
- ✅ `daml_ledger_api` scope

Your provided token has:
- ✅ `openid`
- ✅ `profile`
- ✅ `email`
- ❌ `daml_ledger_api` (MISSING!)

**This is why the upload will fail with your current token.**

---

## 🚀 Recommended Workflow

1. **Build contracts:**
   ```bash
   daml build
   ```

2. **Upload using password grant:**
   ```bash
   ./upload-dar-password-grant.sh
   ```

3. **Verify deployment:**
   ```bash
   # Check if package is on ledger
   curl -k -X GET "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/packages" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

---

## ⚠️ Troubleshooting

### Error: "Token missing daml_ledger_api scope"
**Solution:** Use `upload-dar-password-grant.sh` - it requests the correct scope.

### Error: "403 Forbidden"
**Causes:**
- Token missing `daml_ledger_api` scope
- Token expired
- User doesn't have upload permissions

**Solutions:**
1. Use password grant script (requests correct scope)
2. Get a fresh token
3. Contact admin to grant permissions

### Error: "grpcurl: command not found"
**Solution:**
```bash
# macOS
brew install grpcurl

# Linux
apt-get install grpcurl
```

### Error: "jq: command not found"
**Solution:**
```bash
# macOS
brew install jq

# Linux
apt-get install jq
```

---

## 📝 Notes

- **Password Grant is recommended** because it automatically requests the correct scope
- Your provided token won't work for uploads (missing scope)
- The script tries multiple client IDs to find one that grants `daml_ledger_api`
- If all clients fail, you may need admin to grant the scope to your account

---

## ✅ Success Indicators

After successful upload, you should see:
```
✅ DAR uploaded successfully!
📋 Upload Result:
{...package information...}
🎉 Your contracts are now deployed to Canton!
```
