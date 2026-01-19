# Upload Script Status

## ✅ Improvements Made

1. **Timeout Wrapper Added** - The script now includes `run_grpcurl_with_timeout()` function that:
   - Runs grpcurl in a background process
   - Monitors progress every 2 seconds
   - Shows progress updates every 10 seconds
   - Automatically kills the process after 60 seconds if it hangs
   - Returns exit code 124 on timeout

2. **Token Scope Validation** - Script checks for `daml_ledger_api` scope and warns if missing

3. **Better Error Handling** - Clear error messages for different failure scenarios

## ⚠️ Current Issue

**Your token is missing the `daml_ledger_api` scope**

Current scope: `openid profile email`  
Required scope: `openid profile email daml_ledger_api`

## 🔧 Solution

### Get a Token with Correct Scope

```bash
# Use the helper script
./scripts/get-token-with-scope.sh

# Or manually:
curl -k -X POST https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password' \
  -d 'client_id=Clob' \
  -d 'username=zoya' \
  -d 'password=Zoya123!' \
  -d 'scope=openid profile email daml_ledger_api' | jq -r .access_token
```

### Then Upload

```bash
export JWT_TOKEN="token-from-above"
./scripts/upload-dar.sh
```

## 📝 Notes

- The timeout wrapper should prevent infinite hangs
- Progress updates appear every 10 seconds
- Script will timeout after 60 seconds if connection hangs
- Even with correct scope, uploads can take 30-60 seconds for 682KB files

## 🎯 Next Steps

1. Get token with `daml_ledger_api` scope
2. Test upload with new token
3. If still hangs, check network connectivity
4. Verify server is responding
