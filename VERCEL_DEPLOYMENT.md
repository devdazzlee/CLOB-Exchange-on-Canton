# Vercel Deployment - CORS Fix

## Problem

Your live frontend at `https://clob-exchange-on-canton.vercel.app/` was getting CORS errors because:
- In **development**: Vite proxy handles CORS (works fine)
- In **production**: Frontend makes direct requests to Canton API (CORS blocked)

## Solution

Created Vercel serverless functions to proxy API requests, similar to Vite's proxy in development.

## Files Created

### 1. `frontend/api/canton/[...path].js`
- Vercel serverless function that proxies all `/api/canton/*` requests
- Handles CORS headers
- Forwards requests to Canton API
- Returns responses with proper CORS headers

### 2. `frontend/vercel.json`
- Vercel configuration file
- Sets up rewrites and CORS headers

### 3. Updated `frontend/src/services/cantonApi.js`
- Changed to always use `/api/canton` proxy
- Works in both development (Vite proxy) and production (Vercel function)

## How It Works

### Development (localhost)
```
Frontend → /api/canton/v2/packages
         → Vite Proxy → /json-api/v2/packages
         → Canton API
```

### Production (Vercel)
```
Frontend → /api/canton/v2/packages
         → Vercel Function → /json-api/v2/packages
         → Canton API
```

## Deployment Steps

1. **Commit the changes:**
   ```bash
   git add frontend/api frontend/vercel.json frontend/src/services/cantonApi.js
   git commit -m "Add Vercel serverless function for CORS proxy"
   git push
   ```

2. **Vercel will automatically deploy** (if connected to GitHub)
   - Or manually deploy via Vercel dashboard

3. **Verify deployment:**
   - Check Vercel dashboard for successful deployment
   - Visit https://clob-exchange-on-canton.vercel.app/
   - Check browser console - CORS errors should be gone

## Testing

After deployment, test the API proxy:

```javascript
// In browser console on https://clob-exchange-on-canton.vercel.app/
fetch('/api/canton/v2/packages', {
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

## Expected Behavior

✅ **Success:**
- No CORS errors in browser console
- API requests work normally
- Order book loads
- Orders can be placed

❌ **If still failing:**
- Check Vercel function logs
- Verify the function is deployed
- Check network tab for 200/201 responses instead of CORS errors

## Troubleshooting

### Function Not Found (404)
- Ensure `frontend/api/canton/[...path].js` exists
- Check Vercel deployment logs
- Verify file structure matches Vercel's requirements

### Still Getting CORS Errors
- Check browser console for specific error
- Verify function is receiving requests (check Vercel logs)
- Ensure `vercel.json` is in the `frontend` directory

### 405 Method Not Allowed
- The function should handle all HTTP methods
- Check if OPTIONS requests are handled (preflight)
- Verify the function exports `default` handler

## File Structure

```
frontend/
├── api/
│   └── canton/
│       └── [...path].js    ← Vercel serverless function
├── vercel.json             ← Vercel configuration
└── src/
    └── services/
        └── cantonApi.js    ← Updated to use proxy
```

## Notes

- The serverless function runs on Vercel's edge network
- No additional configuration needed on Canton server
- Works for all API endpoints automatically
- Handles authentication headers properly


