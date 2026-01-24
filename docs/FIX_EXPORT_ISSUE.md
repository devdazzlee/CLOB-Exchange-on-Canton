# Fixed: decryptPrivateKey Export Issue

## Problem
Vite was unable to import `decryptPrivateKey` from `@clob-exchange/crypto` because:
1. Package was built as CommonJS but Vite expects ES modules
2. Module resolution wasn't configured properly

## Solution Applied

### 1. Changed Module Format
- Updated `packages/crypto/tsconfig.json`: Changed `"module": "commonjs"` to `"module": "ES2020"`
- Added `"type": "module"` to `package.json`
- Rebuilt the package

### 2. Updated Package Exports
- Added proper `exports` field in `package.json`
- Configured both `import` and `require` support

### 3. Vite Configuration
- Added alias in `vite.config.ts` to resolve packages from source
- Added `optimizeDeps` configuration

## Verification

The export is confirmed present:
```javascript
export async function decryptPrivateKey(encrypted, password) { ... }
```

## Next Steps

1. Restart the dev server:
```bash
cd apps/web
yarn dev
```

2. If issue persists, clear cache:
```bash
rm -rf node_modules/.vite
yarn dev
```

The package is now built as ES modules and should work with Vite.
