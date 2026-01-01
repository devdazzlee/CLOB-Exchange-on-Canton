# Token Expired - How to Get Fresh Token

## Quick Fix

1. **Go to wallet UI**: https://wallet.validator.dev.canton.wolfedgelabs.com/
2. **Logout and login again** (this will generate a new token)
3. **Get the new token** using browser console:

```javascript
// In browser console (F12)
const tokenKeys = ['access_token', 'token', 'jwt_token', 'auth_token', 'canton_jwt_token'];
let token = null;
for (const key of tokenKeys) {
  const val = localStorage.getItem(key) || sessionStorage.getItem(key);
  if (val && val.startsWith('eyJ')) {
    token = val;
    console.log('Found token:', token);
    break;
  }
}
```

4. **Set it in your app**:
```javascript
localStorage.setItem('canton_jwt_token', token);
```

5. **Refresh the page**

## Or Update Frontend to Auto-Refresh

The frontend should handle token expiration and refresh automatically. For now, manually refresh the token from wallet UI.



