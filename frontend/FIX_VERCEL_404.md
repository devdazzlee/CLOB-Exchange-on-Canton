# Fix Vercel 404 Errors - Step by Step

## 🔴 Current Issue
Vercel is returning 404 errors for `/api/canton/*` routes.

## ✅ Root Cause
The **Root Directory** in Vercel Dashboard is likely NOT set to `frontend`.

## 🛠️ Fix Steps

### Step 1: Set Root Directory in Vercel Dashboard

1. Go to: https://vercel.com/dashboard
2. Select your project: `CLOB-Exchange-on-Canton`
3. Go to: **Settings** → **General**
4. Scroll to: **Root Directory**
5. Set it to: `frontend`
6. Click **Save**

### Step 2: Verify API Directory Structure

Your structure should be:
```
frontend/
├── api/
│   ├── canton/
│   │   └── [...path].js  ← Catch-all route
│   ├── test.js
│   └── hello.js
├── vercel.json
└── package.json
```

### Step 3: Redeploy

After setting Root Directory:

**Option A: Automatic (if connected to Git)**
```bash
# Just push any change to trigger redeploy
cd frontend
git add .
git commit -m "Fix Vercel root directory"
git push
```

**Option B: Manual**
```bash
cd frontend
vercel --prod
```

### Step 4: Test Functions

After redeploy, test:

1. **Simple test:**
   ```bash
   curl https://your-project.vercel.app/api/hello
   ```
   Should return: `{"message": "Hello from Vercel!", ...}`

2. **Canton proxy:**
   ```bash
   curl https://your-project.vercel.app/api/canton/v2/packages
   ```

## 🔍 Verify in Vercel Dashboard

1. Go to: **Vercel Dashboard** → **Your Project**
2. Click: **Functions** tab
3. Should see:
   - `/api/hello`
   - `/api/test`
   - `/api/canton/[...path]`

If functions are NOT listed:
- Root Directory is wrong
- Functions not being detected
- Check deployment logs

## ⚠️ Common Mistakes

1. **Root Directory set to root** (should be `frontend`)
2. **Functions in wrong location** (should be `frontend/api/`)
3. **Build output excluding api/** (check `.vercelignore`)

## ✅ Success Checklist

- [ ] Root Directory = `frontend` in Vercel Dashboard
- [ ] `api/` directory exists at `frontend/api/`
- [ ] Functions listed in Vercel Dashboard → Functions tab
- [ ] `/api/hello` returns 200 (not 404)
- [ ] `/api/canton/*` routes work

## 📞 Still Not Working?

1. **Check Build Logs:**
   - Vercel Dashboard → Deployments → Latest → Build Logs
   - Look for "Functions detected" message

2. **Check Function Logs:**
   - Vercel Dashboard → Functions → View Logs
   - See if requests are reaching functions

3. **Verify File Structure:**
   ```bash
   cd frontend
   ls -la api/
   ls -la api/canton/
   ```

4. **Test Locally:**
   ```bash
   cd frontend
   vercel dev
   # Then test: http://localhost:3000/api/hello
   ```



