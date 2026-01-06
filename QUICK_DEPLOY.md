# ⚡ Quick Deploy - CLOB Exchange

## 🚀 One-Command Deployment

```bash
# Set JWT token (if required)
export JWT_TOKEN="your-jwt-token-here"

# Deploy!
./scripts/upload-dar-live.sh
```

That's it! The script will:
1. ✅ Find your DAR file automatically
2. ✅ Copy it to the dars directory
3. ✅ Upload to Canton participant node
4. ✅ Verify deployment

---

## 📋 What You Need

1. **JWT Token** (if required by your Canton setup)
   - Get from Keycloak or Canton admin
   - Set: `export JWT_TOKEN="your-token"`

2. **Dependencies:**
   ```bash
   # Install grpcurl (if not installed)
   brew install grpcurl  # macOS
   apt-get install grpcurl  # Linux
   
   # Install jq (if not installed)
   brew install jq  # macOS
   apt-get install jq  # Linux
   ```

3. **DAR File:**
   - Already built: `.daml/dist/clob-exchange-1.0.0.dar` ✅
   - If missing: `cd daml && daml build`

---

## 🔧 Alternative: Use Client's Script

If you prefer the original script:

```bash
# 1. Edit upload-dars (2).sh
#    Set: jwt_token="your-token-here"

# 2. Ensure DAR file is in ./dars directory
mkdir -p dars
cp .daml/dist/clob-exchange-1.0.0.dar dars/

# 3. Run
bash "upload-dars (2).sh"
```

---

## ✅ Verify Deployment

```bash
# Test contracts are deployed
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["UserAccount:UserAccount"]}'
```

**Expected:** `[]` or list of contracts (not error)

---

## 🎯 Next Steps

1. **Start Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Test:**
   - Open: http://localhost:3000
   - Create wallet
   - Place order
   - Verify order book

3. **Deploy Frontend:**
   - Build: `npm run build`
   - Deploy to hosting service

---

## 📞 Need Help?

- **Full Guide:** [DEPLOY_LIVE.md](./DEPLOY_LIVE.md)
- **Testing:** [TESTING_GUIDE.md](./TESTING_GUIDE.md)
- **Troubleshooting:** Check DEPLOY_LIVE.md

---

**Status:** ✅ Ready to Deploy!




