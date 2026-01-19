# Actual Fix Required - Deployment & Query Issues

## Current Problems

1. **DAR Upload**: DAR appears uploaded (duplicate error) but templates not queryable
2. **OrderBooks Query**: Getting 403 errors - can't query OrderBooks
3. **Orders Retrieval**: Can't get orders from OrderBooks

## Root Cause Analysis

### Problem 1: DAR Not Actually Active
- **Symptom**: "Templates do not exist" errors
- **Cause**: DAR uploaded but not properly activated/vetted on Canton
- **Solution**: Need to verify DAR is actually active, not just uploaded

### Problem 2: Permission Issues (403 Errors)
- **Symptom**: All queries return 403 "security-sensitive error"
- **Cause**: Admin token doesn't have proper permissions to query contracts
- **Solution**: Need to use operator's token or grant proper permissions

### Problem 3: Package ID Mismatch
- **Symptom**: Backend using wrong package ID
- **Cause**: Hardcoded package ID doesn't match actual uploaded packages
- **Solution**: ✅ FIXED - Backend now uses correct package IDs

## Required Fixes

### Fix 1: Verify DAR is Actually Active

The DAR needs to be **vetted and active**, not just uploaded. Check:

```bash
# Query packages to see if DAR is active
curl -X GET "http://95.216.34.215:31539/v2/packages" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

If packages don't show, DAR needs to be re-uploaded with proper vetting.

### Fix 2: Fix Query Permissions

The 403 errors mean the admin token can't query. Options:

**Option A**: Use operator's token instead of admin token for queries
**Option B**: Grant query permissions to admin token
**Option C**: Use transaction events API (which we're doing, but it's not finding OrderBooks)

### Fix 3: Actually Extract Contract IDs from Creation

The OrderBooks were created (update IDs prove it), but we're not extracting contract IDs. Need to:

1. Query transaction events at the completionOffset
2. Find the created event
3. Extract contract ID
4. Store it for future queries

## Immediate Action Plan

### Step 1: Verify DAR is Active

```bash
# Get admin token
cd backend
node -e "
const admin = require('./canton-admin');
admin.getAdminToken().then(token => {
  console.log('Token:', token.substring(0, 50) + '...');
  
  // Query packages
  fetch('http://95.216.34.215:31539/v2/packages', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json()).then(console.log);
});
"
```

### Step 2: Re-create OrderBooks with Better Contract ID Extraction

The creation endpoint needs to:
1. Wait longer after creation
2. Query with ALL known package IDs
3. Extract contract ID properly
4. Return it in the response

### Step 3: Fix Query Endpoint

The `/api/orderbooks` endpoint needs to:
1. Use transaction events (which we're doing)
2. Search ALL transactions, not just operator party
3. Match OrderBooks by template ID pattern
4. Return contract IDs

## Code Changes Made

✅ Updated backend to use correct package IDs (`51522c77...`, `ebe9b93c...`)
✅ Improved transaction events query
✅ Better contract ID extraction
✅ Added retry logic for template IDs

## What Still Needs to Be Done

1. **Verify DAR is actually active** - The duplicate error might mean it's uploaded but not active
2. **Fix permission issues** - 403 errors need to be resolved
3. **Test query endpoints** - Make sure they actually find OrderBooks
4. **Test order placement** - Verify orders can be placed and retrieved

## Next Steps

1. Check if DAR is actually active on Canton
2. If not, re-upload with proper vetting
3. Re-create OrderBooks (they should work now with correct package IDs)
4. Test query endpoints
5. Test order placement

The code fixes are in place - we just need to verify the DAR is actually active and resolve the permission issues.

