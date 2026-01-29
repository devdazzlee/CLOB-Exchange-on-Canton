# 📦 Package ID Setup Guide

## **REQUIRED: Extract Package ID from DAR File**

The `getPackageIdForTemplate is not a function` error occurs because we need the **package-id** (not package-name) for UserAccount creation.

### **Step 1: Extract Package ID from Your DAR**

```bash
# Navigate to your Canton installation
cd /path/to/canton

# Extract package ID from your DAR file
./bin/canton daml package-id \
  --dar-file /path/to/your/clob-exchange.dar \
  --package-name clob-exchange
```

**Expected output:**
```
Package ID: dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd
```

### **Step 2: Set Environment Variable**

Add to your `.env` file:

```bash
# REQUIRED: Package ID extracted from DAR
CLOB_EXCHANGE_PACKAGE_ID=dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd
```

### **Step 3: Restart Server**

```bash
yarn dev
```

The server will now:
- ✅ Validate package ID at startup
- ✅ Use proper template ID format: `<packageId>:Module:Entity`
- ✅ Create UserAccount contracts successfully

---

## **Template ID Format**

### **❌ WRONG (Package Name Format)**
```
clob-exchange:UserAccount:UserAccount
```

### **✅ CORRECT (Package ID Format)**
```
dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd:UserAccount:UserAccount
```

---

## **What Changed**

### **Fixed Files:**
1. **`src/config/index.js`** - Added package ID validation
2. **`src/utils/templateId.js`** - Template ID helper
3. **`src/services/onboarding-service.js`** - Removed runtime package discovery
4. **`server.js`** - Fixed SIGINT crash

### **Key Improvements:**
- ✅ **No runtime package discovery** - uses configured package ID
- ✅ **Fail-fast validation** - server won't start without package ID
- ✅ **Proper template ID format** - uses package-id format
- ✅ **Graceful shutdown** - no more SIGINT crashes

---

## **Verification**

After setting the package ID:

```bash
# Test server startup
yarn dev

# Should see:
# ✅ Configuration validated successfully
# ✅ Server running on port 3001
```

```bash
# Test wallet creation
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{"partyHint": "test-user"}'
```

Should succeed without `getPackageIdForTemplate` errors.

---

## **Why This Approach**

1. **Digital Asset Recommended** - Use package-id format for stability
2. **No Runtime Discovery** - Avoids API calls and race conditions  
3. **Fail Fast** - Configuration errors caught at startup
4. **Production Ready** - No hardcoded fallbacks

---

## **Next Steps**

1. Extract package ID from your DAR file
2. Set `CLOB_EXCHANGE_PACKAGE_ID` environment variable
3. Restart server
4. Test wallet creation flow

The onboarding flow should now work end-to-end! 🚀
