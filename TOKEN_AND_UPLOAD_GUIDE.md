# Token and DAR Upload Guide

## ✅ Script Updates Complete

The `scripts/upload-dar.sh` script has been updated with:
- ✅ Token expiration checking
- ✅ Scope validation (checks for `daml_ledger_api`)
- ✅ File size display
- ✅ Better error handling
- ✅ Temp file approach (more reliable for large files)

## 🔑 Getting a Token with Correct Scope

### Problem
Your current token has scope: `openid profile email`  
**Missing:** `daml_ledger_api` (required for DAR uploads)

### Solution: Use the Helper Script

```bash
# Get a fresh token with daml_ledger_api scope
./scripts/get-token-with-scope.sh
```

This script will:
1. Try multiple client IDs
2. Use password grant with your credentials (zoya/Zoya123!)
3. Request `daml_ledger_api` scope
4. Output the token ready to use

### Manual Method

If you prefer to get the token manually:

```bash
curl -k -X POST https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password' \
  -d 'client_id=Clob' \
  -d 'username=zoya' \
  -d 'password=Zoya123!' \
  -d 'scope=openid profile email daml_ledger_api' | jq -r .access_token
```

**Note:** The `Clob` client ID works for password grant with `daml_ledger_api` scope.

## 📤 Uploading DAR File

### Step 1: Get Token with Correct Scope

```bash
./scripts/get-token-with-scope.sh
```

Copy the token from the output.

### Step 2: Export Token and Upload

```bash
export JWT_TOKEN="your-token-here"
./scripts/upload-dar.sh
```

### Alternative: One-Liner

```bash
export JWT_TOKEN=$(./scripts/get-token-with-scope.sh 2>/dev/null | grep -A1 "Token:" | tail -1)
./scripts/upload-dar.sh
```

## 🔍 Troubleshooting

### Token Missing Scope

**Symptom:** Script warns "Token is missing 'daml_ledger_api' scope"

**Fix:** Use `./scripts/get-token-with-scope.sh` to get a fresh token

### Upload Hangs

**Possible Causes:**
1. Network connectivity issues
2. Server is slow/overloaded
3. DAR file is large (682KB is reasonable, but may take time)

**Solutions:**
1. Check network: `ping participant.dev.canton.wolfedgelabs.com`
2. Wait longer (uploads can take 30-60 seconds)
3. Try again later if server is busy

### 401/403 Errors

**Symptom:** "unauthorized" or "forbidden" errors

**Fix:** 
- Ensure token has `daml_ledger_api` scope
- Check token hasn't expired
- Get a fresh token

## 📝 Quick Reference

**Get Token:**
```bash
./scripts/get-token-with-scope.sh
```

**Upload DAR:**
```bash
export JWT_TOKEN="token-from-above"
./scripts/upload-dar.sh
```

**Check Token Scope:**
```bash
# Decode token payload
echo "YOUR_TOKEN" | cut -d'.' -f2 | base64 -d | jq -r '.scope'
```

## ✅ Success Indicators

When upload succeeds, you'll see:
```
✓ DAR file uploaded successfully!
Response:
{
  "darIds": [
    "51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9"
  ]
}
✅ Deployment complete!
```

## 🎯 Next Steps After Upload

1. **Create MasterOrderBook contracts:**
   ```bash
   cd backend
   node scripts/deploymentScript.js
   ```

2. **Start the application:**
   ```bash
   # Terminal 1
   cd backend && npm start
   
   # Terminal 2
   cd frontend && npm run dev
   ```

3. **Test in UI:**
   - Login at `http://localhost:3000`
   - Check for "Connected to Global Market" badge
   - Place a test order
