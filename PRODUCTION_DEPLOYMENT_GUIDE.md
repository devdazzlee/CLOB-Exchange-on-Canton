# Production Deployment Guide - Vercel

## 🚀 Quick Deploy to Production

### Option 1: Deploy via Vercel Dashboard (Easiest)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Sign in with GitHub/GitLab/Bitbucket

2. **Import Your Project**
   - Click "Add New Project"
   - Select your repository: `CLOB-Exchange-on-Canton`
   - Set **Root Directory** to: `frontend`
   - Click "Deploy"

3. **Configure Settings**
   - **Framework Preset:** Other
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`

4. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - Your app will be live at: `https://your-project.vercel.app`

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI (if not installed)
npm install -g vercel

# Navigate to frontend directory
cd frontend

# Login to Vercel
vercel login

# Deploy (first time - follow prompts)
vercel

# Deploy to production
vercel --prod
```

### Option 3: Deploy via GitHub (Automatic)

1. **Connect Repository to Vercel**
   - Go to Vercel Dashboard → Settings → Git
   - Connect your GitHub repository
   - Set **Root Directory** to: `frontend`

2. **Configure Build Settings**
   - **Framework Preset:** Other
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`

3. **Auto-Deploy**
   - Every push to `main` branch will auto-deploy
   - Preview deployments for pull requests

---

## ✅ Pre-Deployment Checklist

Before deploying, ensure:

- [ ] All code is committed to Git
- [ ] `frontend/api/canton/[...path].js` exists (serverless function)
- [ ] `frontend/vercel.json` is configured correctly
- [ ] `frontend/package.json` has build script
- [ ] No sensitive data in code (use environment variables)

---

## 🔧 Vercel Configuration

### Current Configuration (`vercel.json`)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "functions": {
    "api/canton/[...path].js": {
      "runtime": "nodejs20.x"
    }
  },
  "rewrites": [
    {
      "source": "/((?!api/).*)",
      "destination": "/index.html"
    }
  ]
}
```

### Important Settings

1. **Root Directory:** Must be set to `frontend` in Vercel dashboard
2. **Build Command:** `npm run build`
3. **Output Directory:** `dist`
4. **Functions:** Serverless functions in `api/` directory

---

## 📝 Step-by-Step Deployment

### Step 1: Prepare Code

```bash
cd frontend

# Ensure all changes are committed
git add .
git commit -m "Ready for production deployment"
git push
```

### Step 2: Deploy to Vercel

**Via Dashboard:**
1. Go to https://vercel.com/new
2. Import repository
3. Set Root Directory: `frontend`
4. Configure build settings
5. Deploy

**Via CLI:**
```bash
cd frontend
vercel --prod
```

### Step 3: Verify Deployment

1. **Check Build Logs**
   - Go to Vercel Dashboard → Deployments
   - Click on latest deployment
   - Check "Build Logs" for errors

2. **Test API Endpoint**
   ```bash
   curl https://your-project.vercel.app/api/test
   ```
   Should return: `{"success": true, ...}`

3. **Test Canton API Proxy**
   ```bash
   curl -X POST https://your-project.vercel.app/api/canton/v2/packages \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

### Step 4: Check Function Logs

1. Go to Vercel Dashboard → Your Project
2. Click "Functions" tab
3. Check logs for `/api/canton/[...path]`
4. Look for any errors

---

## 🐛 Troubleshooting

### Issue: 404 Errors on API Routes

**Symptoms:** `/api/canton/*` returns 404

**Solutions:**
1. **Check Root Directory**
   - Vercel Dashboard → Settings → General
   - Root Directory should be: `frontend`

2. **Verify Function Exists**
   ```bash
   ls -la frontend/api/canton/[...path].js
   ```

3. **Check Build Logs**
   - Vercel Dashboard → Deployments → Build Logs
   - Look for "Functions detected" message

4. **Redeploy**
   ```bash
   cd frontend
   vercel --prod --force
   ```

### Issue: CORS Errors

**Symptoms:** Browser shows CORS errors

**Solutions:**
- Serverless function handles CORS automatically
- Check function logs in Vercel Dashboard
- Verify function is being called (check Network tab)

### Issue: Build Fails

**Symptoms:** Deployment fails during build

**Solutions:**
1. **Check Build Command**
   ```bash
   cd frontend
   npm run build
   ```
   Should complete without errors

2. **Check Dependencies**
   ```bash
   cd frontend
   npm install
   ```

3. **Check Node Version**
   - Vercel uses Node 20.x by default
   - Can be changed in `vercel.json` or dashboard

---

## 🔍 Verify Production Deployment

### 1. Test Frontend
```bash
# Open in browser
https://your-project.vercel.app
```

### 2. Test API Function
```bash
curl https://your-project.vercel.app/api/test
```

### 3. Test Canton Proxy
```bash
curl -X POST https://your-project.vercel.app/api/canton/v2/packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Check Browser Console
- Open DevTools (F12)
- Check Console for errors
- Check Network tab for API calls

---

## 📊 Monitoring

### Vercel Dashboard
- **Deployments:** View all deployments
- **Functions:** View serverless function logs
- **Analytics:** View traffic and performance

### Function Logs
1. Go to Vercel Dashboard → Your Project
2. Click "Functions" tab
3. Select `/api/canton/[...path]`
4. View real-time logs

---

## 🔄 Update Production

### Automatic (via Git)
```bash
# Make changes
git add .
git commit -m "Update production"
git push

# Vercel auto-deploys if connected to Git
```

### Manual
```bash
cd frontend
vercel --prod
```

---

## 🎯 Production URL

After deployment, your app will be available at:
- **Production:** `https://your-project.vercel.app`
- **Preview:** `https://your-project-git-branch.vercel.app`

---

## ✅ Success Checklist

After deployment, verify:

- [ ] Frontend loads correctly
- [ ] `/api/test` endpoint works
- [ ] `/api/canton/v2/packages` endpoint works
- [ ] No CORS errors in browser console
- [ ] Function logs show successful requests
- [ ] All features work (orders, orderbook, etc.)

---

## 📞 Need Help?

- **Vercel Docs:** https://vercel.com/docs
- **Function Logs:** Vercel Dashboard → Functions
- **Build Logs:** Vercel Dashboard → Deployments
- **Support:** Vercel Dashboard → Help


