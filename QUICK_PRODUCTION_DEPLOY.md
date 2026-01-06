# 🚀 Quick Production Deployment

## Fastest Way to Deploy

### Method 1: Vercel Dashboard (Recommended for First Time)

1. **Go to:** https://vercel.com/new
2. **Import** your GitHub repository
3. **Set Root Directory:** `frontend`
4. **Configure:**
   - Framework: Other
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. **Click Deploy**

**Done!** Your app will be live in ~2 minutes.

---

### Method 2: Vercel CLI (Quick)

```bash
cd frontend

# Install Vercel CLI (first time only)
npm install -g vercel

# Login (first time only)
vercel login

# Deploy to production
vercel --prod
```

---

### Method 3: Use Deployment Script

```bash
cd frontend
./deploy.sh
```

---

## ✅ Verify It Works

After deployment, test:

1. **Frontend:** Open `https://your-project.vercel.app`
2. **API Test:** `curl https://your-project.vercel.app/api/test`
3. **Canton API:** Check browser console for API calls

---

## 🔧 Important Settings

**Root Directory:** Must be `frontend` (not root of repo)

**Build Settings:**
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

---

## 📝 Current Status

- ✅ Serverless function configured (`api/canton/[...path].js`)
- ✅ Vercel config ready (`vercel.json`)
- ✅ Build script ready (`package.json`)
- ✅ Deployment guide created (`PRODUCTION_DEPLOYMENT_GUIDE.md`)

**Ready to deploy!** 🎉


