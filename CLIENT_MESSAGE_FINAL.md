# Final Message to Client - Based on Official DAML Documentation

---

Hi [Client Name],

I've reviewed the official DAML documentation and identified the root cause of the 403 errors.

## Root Cause

Your token is a **User Access Token** (scope-based), which means the participant node looks up your user's rights from the User Management Service, rather than reading them from the token itself.

According to the official DAML documentation:
- **Query operations** (like `GetActiveContracts`) require `canReadAs(p)` rights for each party being queried
- **User Access Tokens** don't encode rights in the token - they're looked up from User Management
- Your user `8100b2db-86cf-40a1-8351-55483c151cdc` likely doesn't have `canReadAs` rights configured

## What We Need

Please check and configure the following:

### 1. Verify User Registration
Is user `8100b2db-86cf-40a1-8351-55483c151cdc` registered in User Management?
- Use: `UserManagementService.GetUser`

### 2. Check User Rights
Does the user have `canReadAs` rights?
- Use: `UserManagementService.ListUserRights`
- Should show: `canReadAs` for relevant parties

### 3. Grant Required Rights
Please grant `canReadAs` rights to this user:
- Use: `UserManagementService.GrantUserRights`
- Grant: `canReadAs` for parties that need to be queried
- For querying all contracts: grant `canReadAs` for all relevant parties

## Documentation Reference

From official DAML docs:
- **ActiveContractsService.GetActiveContracts** requires: `for each requested party p: canReadAs(p)`
- **User Access Tokens** require rights to be configured in User Management, not in the token

## Next Steps

Once `canReadAs` rights are configured for user `8100b2db-86cf-40a1-8351-55483c151cdc`, the 403 errors should be resolved and query operations will work.

Please let me know:
1. Is the user registered?
2. What rights does the user currently have?
3. Can you grant `canReadAs` rights?

Thanks!

---
