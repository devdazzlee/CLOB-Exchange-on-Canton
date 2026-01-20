# 🏭 Production-Grade Dynamic Package Discovery

## Overview

This document describes the production-grade solution for dynamic package ID discovery, replacing the previous hardcoded approach.

## Problem Statement

The previous implementation used hardcoded package IDs, which:
- ❌ Required manual updates after each DAR rebuild
- ❌ Broke after redeployments
- ❌ Was not maintainable in production
- ❌ Caused 413 errors when discovery logic failed

## Solution Architecture

### Dynamic Discovery Process

The new `getMasterOrderBookPackageId()` function implements a 3-step discovery process:

#### Step 1: List All Packages (Metadata Query)
```javascript
GET /v2/packages
```
- Queries package metadata (no contract queries)
- Returns list of all uploaded DAR package IDs
- Handles multiple response formats

#### Step 2: Filter for MasterOrderBook Module
- Iterates through packages (most recent first)
- Tests each package for MasterOrderBook template existence
- Uses precise package-qualified template queries

#### Step 3: Execute Specific Query
```javascript
POST /v2/state/active-contracts
{
  filter: {
    filtersByParty: {
      [operatorPartyId]: {
        inclusive: {
          templateIds: [`${pkgId}:MasterOrderBook:MasterOrderBook`]
        }
      }
    }
  }
}
```

**Key Benefits:**
- ✅ Precise filter prevents 413 errors
- ✅ Only queries for specific template (not all contracts)
- ✅ Returns first matching package (most recent)

## Implementation Details

### Files Updated

1. **`backend/server.js`**
   - `getMasterOrderBookPackageId()` function rewritten
   - Used by all OrderBook query endpoints

2. **`backend/matchmaker.js`**
   - `getMasterOrderBookPackageId()` function rewritten
   - Used by matchmaker bot for order matching

### Fallback Strategy

If dynamic discovery fails:
1. Logs warning with error details
2. Falls back to hardcoded package ID
3. System continues to function (graceful degradation)

### Error Handling

- **Package listing fails**: Falls back to hardcoded ID
- **No packages found**: Falls back to hardcoded ID
- **Template not found in package**: Continues to next package
- **Query errors**: Logs and continues to next package

## Benefits

### ✅ Production-Ready
- Works after DAR rebuilds
- Works after redeployments
- No manual configuration needed

### ✅ Maintainable
- Self-healing (discovers correct package automatically)
- Clear logging for debugging
- Graceful fallback on errors

### ✅ Performance
- Efficient queries (package-qualified template IDs)
- Tests most recent packages first
- No unnecessary contract queries

### ✅ Robust
- Handles multiple API response formats
- Works with any number of packages
- Prevents 413 errors with precise filters

## Usage

The function is automatically called by:
- OrderBook query endpoints
- Matchmaker bot
- Admin endpoints

No code changes needed in calling code - it's a drop-in replacement.

## Testing

To verify the solution works:

1. **Rebuild DAR:**
   ```bash
   cd CLOB-Exchange-on-Canton
   daml build
   ```

2. **Upload new DAR:**
   ```bash
   ./scripts/upload-dar.sh
   ```

3. **Restart backend:**
   ```bash
   cd backend
   yarn dev
   ```

4. **Check logs:**
   - Look for `[Package Discovery]` messages
   - Should see "Found MasterOrderBook in package..."
   - Should NOT see hardcoded package ID warnings

## Migration Notes

- **Backward Compatible**: Falls back to hardcoded ID if discovery fails
- **No Breaking Changes**: All existing code continues to work
- **Zero Downtime**: Can be deployed without service interruption

## Future Enhancements

Potential improvements:
1. Cache discovered package ID (with TTL)
2. Package metadata inspection (if API supports it)
3. Package name matching (if package names are available)

---

**Status:** ✅ Production-Ready
**Last Updated:** 2024-01-XX
**Maintainer:** Backend Team
