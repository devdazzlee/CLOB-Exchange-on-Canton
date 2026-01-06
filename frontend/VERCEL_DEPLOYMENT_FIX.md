# Vercel 404 Error Fix

## Problem
The live Vercel deployment (`https://clob-exchange-on-canton.vercel.app/`) was returning 404 errors for API requests to `/api/canton/*` endpoints, even though the same requests worked correctly on localhost.

## Root Cause
1. **Conflicting Rewrite Rule**: The `vercel.json` had a rewrite rule that redirected `/api/canton/:path*` to itself, which could cause routing conflicts.
2. **Missing Build Configuration**: Vercel needed explicit build configuration to recognize the build output directory and serverless functions.

## Solution

### 1. Fixed `vercel.json`
- Removed the conflicting rewrite rule for `/api/canton/:path*` (Vercel automatically handles `api/` directory functions)
- Added explicit build configuration:
  - `buildCommand`: `npm run build`
  - `outputDirectory`: `dist`
  - `framework`: `null` (since we're using Vite, not a framework preset)

### 2. Enhanced Serverless Function
- Improved error handling in `frontend/api/canton/[...path].js`
- Added better logging for debugging
- Added validation for empty paths
- Improved request body handling

### 3. File Structure
```
frontend/
├── api/
│   ├── canton/
│   │   └── [...path].js    # Serverless function (catch-all route)
│   └── test.js              # Test endpoint to verify functions work
├── dist/                    # Build output (created by `npm run build`)
├── src/                     # Source code
├── vercel.json              # Vercel configuration
└── package.json
```

## How Vercel Serverless Functions Work

1. **Automatic Detection**: Vercel automatically recognizes files in the `/api` directory as serverless functions
2. **Catch-All Routes**: The `[...path].js` syntax creates a catch-all route that matches `/api/canton/*`
3. **Path Extraction**: The path segments are available in `req.query.path` as an array
4. **No Rewrite Needed**: Unlike static files, serverless functions don't need rewrite rules in `vercel.json`

## Testing

### 1. Test the Serverless Function
After deployment, test the function endpoint:
```bash
curl https://clob-exchange-on-canton.vercel.app/api/test
```

Expected response:
```json
{
  "success": true,
  "message": "Vercel serverless function is working!",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "method": "GET"
}
```

### 2. Test the Canton API Proxy
```bash
curl -X POST https://clob-exchange-on-canton.vercel.app/api/canton/v2/packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Check Vercel Logs
If issues persist, check the Vercel deployment logs:
1. Go to Vercel Dashboard
2. Select your project
3. Go to "Deployments" → Select latest deployment → "Functions" tab
4. Check logs for `/api/canton/[...path]` function

## Common Issues

### Issue 1: Function Not Found (404)
**Symptoms**: Requests to `/api/canton/*` return 404
**Solutions**:
- Ensure `api/` directory is at the root of what Vercel deploys
- Check that `api/canton/[...path].js` exists
- Verify `.vercelignore` doesn't exclude `api/`
- Check Vercel build logs to ensure the function is detected

### Issue 2: CORS Errors
**Symptoms**: Browser console shows CORS errors
**Solutions**:
- Verify CORS headers are set in the serverless function
- Check that `vercel.json` headers configuration is correct
- Ensure OPTIONS requests are handled (preflight)

### Issue 3: Function Timeout
**Symptoms**: Requests timeout after 10 seconds
**Solutions**:
- Check Canton API response time
- Consider increasing timeout in Vercel project settings
- Optimize the proxy function

### Issue 4: Page Refresh Returns 404
**Symptoms**: Refreshing the page shows 404
**Solutions**:
- Verify the SPA rewrite rule in `vercel.json`: `"source": "/((?!api/).*)", "destination": "/index.html"`
- This ensures all non-API routes serve `index.html` for client-side routing

## Deployment Checklist

- [ ] `vercel.json` is configured correctly (no conflicting rewrites)
- [ ] `api/canton/[...path].js` exists and is properly formatted
- [ ] Build command is set: `npm run build`
- [ ] Output directory is set: `dist`
- [ ] `.vercelignore` doesn't exclude `api/` directory
- [ ] Test endpoint `/api/test` works after deployment
- [ ] Canton API proxy `/api/canton/v2/packages` works after deployment
- [ ] CORS headers are correctly set
- [ ] SPA routing works (page refresh doesn't show 404)

## Next Steps

1. **Deploy to Vercel**: Push changes and let Vercel rebuild
2. **Test the Function**: Use the test endpoint to verify functions work
3. **Test the Proxy**: Verify Canton API requests work through the proxy
4. **Check Logs**: Monitor Vercel function logs for any errors
5. **Verify CORS**: Test from browser to ensure CORS is working

## Additional Notes

- The serverless function runs on Node.js runtime (default for Vercel)
- Functions have a 10-second timeout by default (can be increased in Vercel settings)
- Function logs are available in Vercel Dashboard → Functions tab
- The function automatically handles CORS for all origins
- Request/response bodies are automatically parsed by Vercel


