# 🚀 Test Frontend Now - Token Configured!

## ✅ Token Status

✅ Token extracted from Wallet UI  
✅ Token saved to `frontend/.env`  
✅ Token has correct scopes: `daml_ledger_api`  
✅ Frontend code configured to use token  

---

## 🎯 Quick Test Steps

### 1. Restart Frontend (IMPORTANT!)

The frontend needs to restart to load the new token from `.env`:

```bash
cd frontend
# Stop current server (Ctrl+C if running)
yarn dev
# or
npm run dev
```

### 2. Open Browser

Go to: **http://localhost:3000**

### 3. Open Browser Console

Press `F12` → Go to **Console** tab

You should see:
```
[Auth] Using token from environment variable
```

### 4. Test Wallet Creation

1. Click "Create New Wallet"
2. Enter password
3. Click "Generate Wallet"
4. Check console - should see successful API calls!

### 5. Test API Calls

After wallet is created, check console for:
- ✅ `[Auth] Using token from environment variable`
- ✅ `[Proxy] GET /api/canton/v2/state/active-contracts -> /json-api/v2/state/active-contracts`
- ✅ `[Proxy] Response: 200` (not 401!)

---

## 🔍 What to Check

### ✅ Success Indicators:

1. **No 401 errors** in console
2. **200 OK** responses from API
3. **Wallet creates successfully**
4. **Balances load** (even if 0)
5. **Order book loads** (even if empty)

### ❌ If Still Getting 401:

1. **Check token expiration**: Token expires in ~23 minutes
2. **Get fresh token**: Follow steps in `GET_TOKEN_FROM_WALLET_UI.md`
3. **Update .env**: Replace token in `frontend/.env`
4. **Restart frontend**: Stop and start again

---

## 📝 Token Expiration

**Current token expires**: ~23 minutes from now

When token expires:
1. Go back to Wallet UI
2. Open Dev Tools → Network tab
3. Make a request
4. Copy new token from Authorization header
5. Update `frontend/.env`
6. Restart frontend

---

## 🎉 Expected Result

After restarting frontend with the token:

✅ No more 401 Unauthorized errors  
✅ API calls succeed  
✅ Wallet creation works  
✅ Order placement works  
✅ Order book displays  

---

## 🆘 Troubleshooting

**If token doesn't work:**

1. Verify token in `.env`:
   ```bash
   cat frontend/.env | grep VITE_CANTON_JWT_TOKEN
   ```

2. Check token format (should start with `eyJ`):
   ```bash
   head -c 50 frontend/.env
   ```

3. Verify frontend restarted:
   - Check terminal shows "VITE v..." 
   - Check browser console shows `[Auth] Using token...`

4. Check proxy logs:
   - Terminal running `yarn dev` should show `[Proxy]` logs

---

**Ready to test!** 🚀

