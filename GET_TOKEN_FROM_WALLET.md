# How to Get JWT Token from Wallet UI

## Method 1: Browser Developer Tools (Easiest)

1. **Open the wallet UI**: https://wallet.validator.dev.canton.wolfedgelabs.com/
2. **Login** to your account
3. **Open Browser Console** (F12 or Right-click → Inspect → Console tab)
4. **Run this command**:
```javascript
// Check localStorage
localStorage.getItem('access_token') || 
localStorage.getItem('token') || 
localStorage.getItem('jwt_token') || 
localStorage.getItem('auth_token') ||
localStorage.getItem('canton_jwt_token')

// Or check sessionStorage
sessionStorage.getItem('access_token') || 
sessionStorage.getItem('token') || 
sessionStorage.getItem('jwt_token')
```

5. **If found**, copy the token value

## Method 2: Network Tab (Most Reliable)

1. **Open the wallet UI** and login
2. **Open Developer Tools** (F12)
3. **Go to Network tab**
4. **Filter by "Fetch/XHR"** or search for "api" or "token"
5. **Look for API requests** (especially authentication/login requests)
6. **Click on a request** → **Headers tab**
7. **Look for**:
   - `Authorization: Bearer <token>`
   - Or check **Response** tab for token in JSON response
8. **Copy the token**

## Method 3: Application Tab (Check Storage)

1. **Open Developer Tools** (F12)
2. **Go to Application tab** (Chrome) or **Storage tab** (Firefox)
3. **Expand "Local Storage"** → Click on the wallet domain
4. **Look for**:
   - `access_token`
   - `token`
   - `jwt_token`
   - `auth_token`
   - `canton_jwt_token`
5. **Copy the value**

## Method 4: Check All Storage

Run this in console to check all possible locations:

```javascript
// Check all localStorage keys
console.log('LocalStorage:', Object.keys(localStorage).filter(k => k.toLowerCase().includes('token') || k.toLowerCase().includes('auth')));

// Check all sessionStorage keys
console.log('SessionStorage:', Object.keys(sessionStorage).filter(k => k.toLowerCase().includes('token') || k.toLowerCase().includes('auth')));

// Try to get common token names
const tokenKeys = ['access_token', 'token', 'jwt_token', 'auth_token', 'canton_jwt_token', 'bearer_token'];
tokenKeys.forEach(key => {
  const val = localStorage.getItem(key) || sessionStorage.getItem(key);
  if (val) console.log(`${key}:`, val);
});
```

## Method 5: Check Cookies

1. **Open Developer Tools** (F12)
2. **Go to Application tab** → **Cookies**
3. **Look for** token-related cookies
4. **Copy the value**

## After Getting the Token

Once you have the token, decode it:

**Option A: Browser Console**
```javascript
const token = 'YOUR_TOKEN_HERE';
const payload = JSON.parse(atob(token.split('.')[1]));
console.log(JSON.stringify(payload, null, 2));
```

**Option B: Online Tool**
- Go to https://jwt.io
- Paste your token
- Copy the decoded payload

## What to Look For

In the decoded token, check:
- `sub`: Should be `8100b2db-86cf-40a1-8351-55483c151cdc`
- `aud`: Should include Canton audience
- `scope`: Should include `daml_ledger_api`
- `exp`: Check if token is expired




