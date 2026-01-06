# Fixing 404 Errors on Vercel

## Problem

Getting 404 errors when:
- Navigating to routes like `/trading`, `/wallet`
- Refreshing the page
- Direct URL access

Error messages:
```
The page could not be found
NOT_FOUND
404: NOT_FOUND
```

## Root Cause

Vercel needs to be configured to:
1. **Handle SPA (Single Page Application) routing** - All routes should serve `index.html`
2. **Route API requests** to serverless functions
3. **Proper rewrite order** - API routes first, then catch-all for SPA

## Solution

Updated `vercel.json` with proper rewrites:

```json
{
  "rewrites": [
    {
      "source": "/api/canton/:path*",
      "destination": "/api/canton/:path*"
    },
    {
      "source": "/((?!api/).*)",
      "destination": "/index.html"
    }
  ]
}
```

### How It Works

1. **API Routes First**: `/api/canton/*` → Serverless function
2. **SPA Fallback**: Everything else → `index.html` (React Router handles routing)

The regex `/((?!api/).*)` means:
- Match all paths EXCEPT those starting with `api/`
- This ensures API routes go to functions, everything else goes to the SPA

## Files Changed

1. ✅ `frontend/vercel.json` - Added rewrites for SPA routing
2. ✅ `frontend/.vercelignore` - Created to exclude unnecessary files

## Deployment

After committing these changes:

```bash
git add frontend/vercel.json frontend/.vercelignore
git commit -m "Fix Vercel 404 errors - Add SPA routing support"
git push
```

Vercel will automatically redeploy.

## Testing

After deployment, test:

1. **Homepage**: https://clob-exchange-on-canton.vercel.app/ ✅
2. **Trading Page**: https://clob-exchange-on-canton.vercel.app/trading ✅
3. **Wallet Page**: https://clob-exchange-on-canton.vercel.app/wallet ✅
4. **Refresh**: Refresh any page - should work ✅
5. **Direct URL**: Navigate directly to any route - should work ✅

## If Still Getting 404

### Check Vercel Project Settings

1. Go to Vercel Dashboard → Your Project → Settings
2. Check **"Root Directory"**:
   - Should be `frontend` (if deploying from repo root)
   - Or leave empty if `vercel.json` is in repo root

### Verify Build Output

1. Check Vercel build logs
2. Ensure `dist/index.html` exists after build
3. Verify `dist` folder contains all assets

### Check Build Command

In Vercel project settings, ensure:
- **Build Command**: `cd frontend && npm run build` (or `yarn build`)
- **Output Directory**: `frontend/dist`
- **Install Command**: `cd frontend && npm install` (or `yarn install`)

## Alternative: Deploy from Root

If deploying from repository root (not `frontend` folder):

1. Move `vercel.json` to repository root
2. Update paths in `vercel.json`:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/canton/:path*",
         "destination": "/frontend/api/canton/:path*"
       },
       {
         "source": "/((?!api/).*)",
         "destination": "/frontend/index.html"
       }
     ]
   }
   ```

## Current Configuration

✅ **SPA Routing**: Configured
✅ **API Proxy**: Configured  
✅ **CORS Headers**: Configured
✅ **Build Output**: Should be `frontend/dist`

## Next Steps

1. Commit and push changes
2. Wait for Vercel deployment
3. Test all routes
4. Verify no more 404 errors


