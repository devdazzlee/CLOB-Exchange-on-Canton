# 🔑 How to Get Token from Wallet UI

## Client's Response

"You need to use bearer token auth for accessing both admin and json api"

"A quick way would be to get it from wallet ui and get it from request header from dev tools"

---

## Steps to Get Token

### Step 1: Open Wallet UI
1. Go to the Wallet UI application (provided by client)
2. Login if needed

### Step 2: Open Browser Dev Tools
1. Press `F12` or `Right-click → Inspect`
2. Go to **Network** tab
3. Make sure "Preserve log" is checked

### Step 3: Make a Request
1. Perform any action in Wallet UI (like viewing balance, placing order, etc.)
2. This will generate network requests

### Step 4: Find the Request
1. Look for requests to `json-api` or `participant.dev.canton.wolfedgelabs.com`
2. Click on one of the requests

### Step 5: Get the Token
1. In the request details, go to **Headers** section
2. Look for **Authorization** header
3. Copy the token (the part after "Bearer ")

Example:
```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0...
```

Copy everything after "Bearer " (without the word "Bearer")

---

## Step 6: Update Frontend

Once you have the token:

1. Update `frontend/.env`:
   ```
   VITE_CANTON_JWT_TOKEN=your-token-here
   ```

2. Or set in browser console:
   ```javascript
   localStorage.setItem('canton_jwt_token', 'your-token-here')
   ```

3. Restart frontend and test

---

## Alternative: Check Wallet UI Code

If you have access to Wallet UI source code, check how they're getting/using the token.

