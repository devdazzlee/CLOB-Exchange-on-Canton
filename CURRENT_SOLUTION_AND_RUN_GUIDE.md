# Current Solution & How to Run

## 🎯 Current Solution Summary

We're using a **proxy approach** to handle CORS issues because the Canton API server doesn't allow direct requests from your frontend domain.

### Architecture

```
Browser → Proxy → Canton API
         (no CORS)  (server-to-server)
```

### Two Environments:

1. **Development (Localhost)**
   - Uses **Vite proxy** (`vite.config.js`)
   - Routes `/api/canton/*` → `https://participant.dev.canton.wolfedgelabs.com/json-api/*`
   - ✅ Works perfectly

2. **Production (Vercel)**
   - Uses **Vercel serverless function** (`frontend/api/canton/[...path].js`)
   - Routes `/api/canton/*` → Canton API
   - ⚠️ Currently has 404 errors (being fixed)

---

## 🚀 How to Run

### Option 1: Development (Recommended - Works Perfectly)

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies (if not already installed)
npm install

# Start development server
npm run dev
```

**That's it!** The app will run at:
- **URL:** http://localhost:3000
- **Proxy:** Automatically handles CORS via Vite proxy
- **Status:** ✅ Fully functional

### Option 2: Production Build (Local Testing)

```bash
cd frontend

# Build for production
npm run build

# Preview production build locally
npm run preview
```

**Note:** This uses the built files but still needs the Vite proxy for API calls.

### Option 3: Deploy to Vercel (Production)

```bash
cd frontend

# Make sure you're in the frontend directory
# Push to GitHub (if connected to Vercel)
git add .
git commit -m "Deploy to Vercel"
git push

# Or use Vercel CLI
npx vercel
```

**Current Status:** ⚠️ Vercel deployment has 404 errors for API routes (serverless function not being detected)

---

## 📁 Key Files

### 1. API Service (`frontend/src/services/cantonApi.js`)
```javascript
// Uses proxy endpoint
const CANTON_API_BASE = '/api/canton';  // Proxy route
```

### 2. Vite Proxy (`frontend/vite.config.js`)
```javascript
proxy: {
  '/api/canton': {
    target: 'https://participant.dev.canton.wolfedgelabs.com',
    rewrite: (path) => path.replace(/^\/api\/canton/, '/json-api')
  }
}
```

### 3. Vercel Serverless Function (`frontend/api/canton/[...path].js`)
- Handles API requests in production
- Currently returning 404 errors (needs fix)

---

## ✅ What Works Now

### Development (Localhost)
- ✅ Frontend runs perfectly
- ✅ API calls work via Vite proxy
- ✅ No CORS issues
- ✅ All features functional

### Production (Vercel)
- ✅ Frontend deploys
- ✅ Static files work
- ⚠️ API calls return 404 (serverless function issue)
- ⚠️ Need to fix Vercel function detection

---

## 🔧 Quick Start Commands

### Start Development Server
```bash
cd frontend
npm run dev
```

### Build for Production
```bash
cd frontend
npm run build
```

### Test Production Build Locally
```bash
cd frontend
npm run preview
```

---

## 🐛 Current Issues

### Issue 1: Vercel 404 Errors
**Problem:** API requests return 404 on Vercel deployment
**Status:** Being fixed (serverless function configuration)

### Issue 2: CORS Workaround
**Problem:** Using proxy instead of direct API calls
**Solution:** Contact Canton node operator to add CORS configuration
**Status:** Template configuration file created (`canton.conf`)

---

## 📝 Next Steps

### Immediate (To Fix Vercel)
1. Fix Vercel serverless function detection
2. Ensure `api/` directory is included in deployment
3. Test API endpoints on live Vercel deployment

### Long-term (Proper Solution)
1. Contact Wolf Edge Labs to add CORS configuration
2. Remove proxy code once CORS is configured
3. Use direct API calls to Canton

---

## 🎯 Recommended Approach

**For now, use Development mode:**
```bash
cd frontend
npm run dev
```

This works perfectly and you can develop/test all features without any issues.

**For production:**
- Wait for Vercel function fix, OR
- Contact Canton node operator to add CORS (proper solution)

---

## 📞 Need Help?

- **Development issues:** Check browser console (F12)
- **API issues:** Check network tab in browser dev tools
- **Vercel issues:** Check Vercel deployment logs
- **CORS issues:** See `HOW_TO_CONFIGURE_CORS_IN_CANTON.md`

