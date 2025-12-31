Hi,

I've completed the frontend integration with Canton JSON Ledger API v2. Following up on our previous conversation about the endpoints:

**Endpoints Confirmed:**
- `participant.dev.canton.wolfedgelabs.com` → admin-api (grpc) ✅
- `participant.dev.canton.wolfedgelabs.com/json-api` → json-api ✅

**Current Status:**
✅ Frontend integrated with JSON API v2 endpoints
✅ Authentication system implemented
✅ Ready for production

**Question:**

The JSON API endpoints (`/v2/state/active-contracts`, `/v2/commands/submit-and-wait`) are returning 401 Unauthorized.

**What authentication method should be used for JSON API?**

1. Does JSON API require authentication, or is it publicly accessible?
2. If authentication is required:
   - Should I use the same JWT token approach as admin-api?
   - Or is there a different authentication method (API keys, service account, etc.)?
   - What Keycloak client and scopes should be used?

The current token (used for admin-api) has audience="account" which doesn't have permissions for JSON API endpoints.

**What I Need:**

Please clarify the authentication setup for JSON API so I can complete the integration properly.

Thanks!
