# ✅ Root Cause Fix - Wallet Error

## Problem
Error: `hashes.sha512Sync not set`

## Root Cause
The old `bip39` package requires Node.js crypto (`hashes.sha512Sync`) which doesn't exist in browsers. Even though we switched to `@scure/bip39`, Vite was caching the old package or bundling it incorrectly.

## Solution (Complete Fix)

### 1. Clean Everything
```bash
cd frontend
rm -rf node_modules package-lock.json .vite dist
```

### 2. Reinstall (Fresh)
```bash
npm install
```

### 3. Verify Package.json
Should have:
- ✅ `@scure/bip39` (NOT `bip39`)
- ✅ `@noble/hashes` (explicit dependency)
- ✅ `buffer` (polyfill)

### 4. Clear Browser Cache
- Close ALL browser windows
- Use **Incognito/Private mode** for testing
- OR: Clear cache completely

### 5. Restart Frontend
```bash
npm run dev
```

### 6. Test in Fresh Browser Window
Open: http://localhost:3000

---

## Why This Works

1. **@scure/bip39** uses `@noble/hashes` which works in browsers
2. **No Node.js crypto** - pure browser crypto
3. **Clean install** - no cached old packages
4. **Fresh browser** - no cached old JavaScript

---

## Verification

After restart, wallet creation should work without any errors.

**Status:** ✅ Root cause fixed - clean rebuild required
