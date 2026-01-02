# Fix Keycloak Redirect URI Error

## 🔴 Error
```
Invalid parameter: redirect_uri
```

This means `http://localhost:3000/auth/callback` is not configured in Keycloak.

## ✅ Solution 1: Add Redirect URI to Keycloak (If You Have Admin Access)

### Steps:

1. **Login to Keycloak Admin Console:**
   - Go to: https://keycloak.wolfedgelabs.com:8443/admin
   - Username: `zoya`
   - Password: `Zoya123!`
   - Select realm: `canton-devnet`

2. **Navigate to Client:**
   - Left sidebar → **Clients**
   - Find client: `4roh9X7y4TyT89feJu7AnM2sMZbR9xh7`
   - Click on it

3. **Add Redirect URI:**
   - Go to **Settings** tab
   - Find **Valid redirect URIs**
   - Click **Add valid redirect URI**
   - Add: `http://localhost:3000/auth/callback`
   - For production, also add: `https://clob-exchange-on-canton.vercel.app/auth/callback`
   - Click **Save**

4. **Test:**
   - Refresh your frontend
   - Click "Login"
   - Should work now!

---

## ✅ Solution 2: Use Password Grant Flow (No Redirect Needed)

If you don't have Keycloak admin access, I'll implement a password grant flow that doesn't need redirect URIs.

This is still professional - users enter credentials in your app, and tokens are obtained automatically.

---

## 🎯 Which Solution?

- **Have Keycloak admin access?** → Use Solution 1 (OAuth redirect flow)
- **No admin access?** → Use Solution 2 (Password grant flow)

Let me know which you prefer, and I'll implement it!

