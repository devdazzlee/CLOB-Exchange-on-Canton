# Deploy DAR and Get Package ID

## ✅ Implementation Complete

I've implemented automatic package ID detection. The system will:

1. **Automatically query the ledger** on first API call
2. **Extract package ID** from deployed contracts
3. **Cache the package ID** for subsequent calls
4. **Qualify all template IDs** automatically

## 🚀 Deployment Steps

### Step 1: Deploy DAR File

```bash
# Option A: With JWT token (if required)
export JWT_TOKEN="your-token-here"
bash scripts/upload-dar.sh

# Option B: Without token (if not required)
bash scripts/upload-dar.sh
```

### Step 2: Verify Deployment

The package ID will be automatically detected when you:
1. Open the frontend application
2. Make any API call (query contracts, create contract, etc.)
3. Check browser console for: `[API] Package ID detected: <package-id>`

### Step 3: Manual Package ID Query (Optional)

If you want to get the package ID manually:

```bash
# With token
bash scripts/get-package-id.sh "your-token-here"

# Without token (if not required)
bash scripts/get-package-id.sh
```

## 📋 What Changed

### New Functions Added

1. **`getPackageId(forceRefresh)`**
   - Queries ledger for deployed contracts
   - Extracts package ID from `templateId`
   - Caches result to avoid repeated queries
   - Falls back to OrderBook if UserAccount not found

2. **`qualifyTemplateId(templateId, packageId)`**
   - Converts unqualified template IDs to fully qualified
   - Automatically fetches package ID if needed
   - Handles both "Module:Template" and "Template" formats

### Updated Functions

- `queryContracts()` - Now automatically qualifies template IDs
- `createContract()` - Now automatically qualifies template IDs
- All template IDs are now fully qualified: `<package-id>:Module:Template`

## 🔍 How It Works

**Before (Unqualified):**
```javascript
queryContracts('UserAccount:UserAccount', partyId)
// API receives: "UserAccount:UserAccount"
```

**After (Automatically Qualified):**
```javascript
queryContracts('UserAccount:UserAccount', partyId)
// API receives: "<package-id>:UserAccount:UserAccount"
// Package ID is automatically detected and added
```

## ✅ Benefits

1. **No Manual Configuration** - Package ID is auto-detected
2. **Automatic Caching** - Only queries once, then cached
3. **Backward Compatible** - Existing code still works
4. **Production Ready** - Follows official JSON API v2 spec

## 🧪 Testing

1. Start the frontend: `cd frontend && npm run dev`
2. Open browser console
3. Navigate to trading page
4. Look for: `[API] Package ID detected: <package-id>`
5. All subsequent API calls will use the qualified template IDs

## 📝 Notes

- Package ID is cached in memory (not persisted)
- To force refresh: `await getPackageId(true)`
- Package ID detection happens automatically on first API call
- No changes needed to existing code - it's all automatic!


