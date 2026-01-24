# Clear Browser Cache - Fix Wallet Error

## Problem
The error "Private key must be 32 bytes" is coming from a cached version of the crypto package in your browser.

## Solution

### 1. Hard Refresh Browser
- **Chrome/Edge**: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- **Firefox**: `Ctrl+F5` (Windows) or `Cmd+Shift+R` (Mac)
- **Safari**: `Cmd+Option+R`

### 2. Clear Browser Cache
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

### 3. Restart Dev Server
```bash
# Stop the dev server (Ctrl+C)
cd apps/web
rm -rf node_modules/.vite
rm -rf dist
yarn dev
```

### 4. Verify Fix
The error message should now say:
- ✅ "Private key too short: X bytes, need at least 16" (if key is too short)
- ❌ NOT "Private key must be 32 bytes" (old cached version)

## What Was Fixed

1. **generateKeyPair()**: Now properly ensures 32-byte private keys
2. **deriveSeedPhrase()**: Changed to accept keys with at least 16 bytes (not exactly 32)
3. **Error messages**: Updated to be more descriptive

## If Error Persists

1. **Clear all browser data**:
   - Chrome: Settings → Privacy → Clear browsing data → Cached images and files
   - Firefox: Settings → Privacy → Clear Data → Cached Web Content

2. **Use Incognito/Private Window**:
   - This ensures no cached files are used

3. **Check Network Tab**:
   - Open DevTools → Network tab
   - Look for `@clob-exchange/crypto` requests
   - Check if they're being served from cache
   - Disable cache in DevTools settings

## Verification

After clearing cache, the wallet creation should work. The private key will always be exactly 32 bytes from `generateKeyPair()`, and `deriveSeedPhrase()` will accept it without throwing the old error.
