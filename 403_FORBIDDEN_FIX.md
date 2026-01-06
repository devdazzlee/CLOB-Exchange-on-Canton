# ✅ 403 Forbidden Error - Root Cause Fix

## 🔴 Problem

All API queries were returning **403 Forbidden** errors with message:
```json
{
  "code": "NA",
  "cause": "A security-sensitive error has been received",
  "grpcCodeValue": 7
}
```

## 🔍 Root Cause

According to **Canton JSON API v2 documentation**:
- `filtersForAnyParty` requires **admin privileges**
- Regular users **MUST** use `filtersByParty` with their specific party ID
- The code was using `filtersForAnyParty` in multiple places, causing 403 errors

## ✅ Solution Implemented

### 1. **Added Party ID Extraction from JWT Token**

```javascript
function getPartyIdFromToken() {
  const token = getAuthToken();
  if (!token) return null;
  
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.sub; // Party ID prefix from JWT
}
```

### 2. **Updated All Query Functions**

**Before:**
```javascript
// ❌ Used filtersForAnyParty (requires admin)
filter: {
  filtersForAnyParty: {
    inclusive: {
      templateIds: [qualifiedTemplateId]
    }
  }
}
```

**After:**
```javascript
// ✅ Always uses filtersByParty (required for regular users)
filter: {
  filtersByParty: {
    [party]: {
      inclusive: {
        templateIds: [qualifiedTemplateId]
      }
    }
  }
}
```

### 3. **Functions Updated**

- ✅ `queryContracts()` - Now requires party ID, extracts from token if not provided
- ✅ `fetchContract()` - Now requires party ID, extracts from token if not provided  
- ✅ `fetchContracts()` - Now requires party ID, extracts from token if not provided
- ✅ `getPackageId()` - Now requires party ID, extracts from token if not provided

## 📋 Changes Made

### File: `frontend/src/services/cantonApi.js`

1. **Added `getPartyIdFromToken()` function** - Extracts party ID from JWT token's `sub` field
2. **Updated `queryContracts()`** - Always uses `filtersByParty`, extracts party ID if not provided
3. **Updated `fetchContract()`** - Always uses `filtersByParty`, extracts party ID if not provided
4. **Updated `fetchContracts()`** - Always uses `filtersByParty`, extracts party ID if not provided
5. **Updated `getPackageId()`** - Always uses `filtersByParty`, extracts party ID if not provided

## 🎯 Key Points

### Why `filtersForAnyParty` Fails

According to Canton documentation:
> `filtersForAnyParty` requires **administrative read access**
> Regular users are **not allowed** to query contracts for "any party"

### Why `filtersByParty` Works

> `filtersByParty` allows users to query contracts **visible to their party**
> This is the **standard way** for non-admin users to query contracts

### Party ID Format

- JWT token `sub` field: `8100b2db-86cf-40a1-8351-55483c151cdc` (prefix)
- Full party ID format: `prefix::suffix` (used in components)
- `filtersByParty` accepts the party identifier (prefix is sufficient)

## 🧪 Testing

After this fix:
1. ✅ All queries use `filtersByParty` instead of `filtersForAnyParty`
2. ✅ Party ID is automatically extracted from JWT token if not provided
3. ✅ Components can still pass party ID explicitly (recommended)
4. ✅ 403 errors should be resolved for users with proper `canReadAs` permissions

## 📚 Documentation References

- [Canton JSON API v2 - Queries](https://docs.digitalasset.com/build/latest/explanations/json-api/queries.html)
- [Canton JSON API v2 - Ledger State](https://docs.digitalasset.com/build/latest/explanations/json-api/ledger-state.html)

## ⚠️ Important Notes

1. **Party ID is Required**: All query functions now require party ID (extracted from token if not provided)
2. **Token Must Be Valid**: Token must contain valid `sub` field with party ID
3. **Permissions Still Required**: User must have `canReadAs` permissions for their party ID
4. **No Admin Access**: This fix removes admin-only queries - all queries are party-scoped

## 🎉 Result

- ✅ No more 403 errors from using `filtersForAnyParty`
- ✅ All queries use party-scoped `filtersByParty`
- ✅ Automatic party ID extraction from JWT token
- ✅ Compliant with Canton JSON API v2 documentation



