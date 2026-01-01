# Verify Production APIs on Vercel

## 🧪 Quick Test

Run this command (replace with your Vercel URL):

```bash
cd frontend
./test-production-apis.sh https://your-project.vercel.app
```

Or test manually:

### 1. Test Serverless Function

```bash
curl https://your-project.vercel.app/api/test
```

**Expected:** 
```json
{
  "success": true,
  "message": "Vercel serverless function is working!",
  "timestamp": "...",
  "method": "GET"
}
```

**If 404:** Serverless function not detected
**If 200:** ✅ Functions are working!

---

### 2. Test Canton API Proxy

```bash
curl -X POST https://your-project.vercel.app/api/canton/v2/packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected:**
- **200:** ✅ Proxy working, API responding
- **401:** ✅ Proxy working, but auth needed (this is OK - proxy is working!)
- **404:** ❌ Proxy not working (function not detected)

---

## ✅ Current Configuration Status

### What's Configured:

1. ✅ **Serverless Function:** `frontend/api/canton/[...path].js`
2. ✅ **Test Endpoint:** `frontend/api/test.js`
3. ✅ **Vercel Config:** `frontend/vercel.json` with function definitions
4. ✅ **CORS Headers:** Configured in function

### What Might Be Wrong:

If you're getting **404 errors**, check:

1. **Root Directory in Vercel**
   - Go to: Vercel Dashboard → Settings → General
   - **Root Directory** must be: `frontend` (not root)

2. **Function Detection**
   - Go to: Vercel Dashboard → Your Project → Functions tab
   - Should see: `/api/canton/[...path]` and `/api/test`
   - If not listed: Functions not detected

3. **Build Logs**
   - Go to: Vercel Dashboard → Deployments → Latest → Build Logs
   - Look for: "Functions detected" message
   - Check for errors

4. **Function Logs**
   - Go to: Vercel Dashboard → Functions → `/api/canton/[...path]`
   - Check logs for errors

---

## 🔧 If APIs Are NOT Working (404 Errors)

### Fix 1: Verify Root Directory

1. Vercel Dashboard → Settings → General
2. Set **Root Directory:** `frontend`
3. Redeploy

### Fix 2: Check Function Files Exist

```bash
cd frontend
ls -la api/canton/[...path].js
ls -la api/test.js
```

Both files should exist.

### Fix 3: Redeploy

```bash
cd frontend
vercel --prod --force
```

### Fix 4: Check Vercel Config

Ensure `vercel.json` has:
```json
{
  "functions": {
    "api/canton/[...path].js": {
      "runtime": "nodejs20.x"
    }
  }
}
```

---

## 📊 Status Check

### ✅ APIs Working If:
- `/api/test` returns 200
- `/api/canton/v2/packages` returns 200 or 401 (not 404)
- Function logs show requests in Vercel Dashboard

### ❌ APIs NOT Working If:
- Both endpoints return 404
- Functions tab is empty in Vercel Dashboard
- Build logs show no functions detected

---

## 🎯 Next Steps

1. **Test the endpoints** using the script above
2. **Check Vercel Dashboard** → Functions tab
3. **If 404:** Fix Root Directory and redeploy
4. **If working:** ✅ You're good to go!

---

## 📞 Need Help?

- **Vercel Functions Docs:** https://vercel.com/docs/functions
- **Check Logs:** Vercel Dashboard → Functions → View Logs
- **Support:** Vercel Dashboard → Help

