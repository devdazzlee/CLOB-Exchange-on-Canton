# Message to Client

---

Hi [Client Name],

I've completed the integration of the frontend with the Canton JSON API. Here's the status:

## ✅ Completed

1. **API Integration**: Updated all endpoints to use Canton JSON Ledger API v2 (official endpoints)
2. **Authentication**: Implemented JWT token authentication system
3. **Proxy Configuration**: Set up CORS proxy for development
4. **Code Quality**: All code follows best practices, no patch work

## ⚠️ Current Issue

The frontend is ready, but we're getting **401 Unauthorized** errors. After investigation, I found that:

**The JWT token you provided has the wrong audience/scopes:**
- Current token audience: `account` (Keycloak account management)
- Required audience: `json-api` or similar (for JSON API endpoints)

The token is valid but doesn't have permissions for the JSON API endpoints.

## 🔧 What's Needed

Please provide a **JWT token with correct permissions** for the JSON API:

1. **Correct Keycloak Client ID** for JSON API access
2. **Required Scopes** for JSON API endpoints
3. **New Token** obtained with the correct client/scopes

OR

If the JSON API doesn't require authentication, please confirm and I'll update the code accordingly.

## 📋 Technical Details

- **API Endpoints**: Using `/v2/state/active-contracts` and `/v2/commands/submit-and-wait`
- **Authentication**: JWT Bearer token in Authorization header
- **Current Token**: Valid but wrong audience (`account` instead of `json-api`)

## 🚀 Once Token is Updated

1. I'll update the token in the configuration
2. Restart the frontend
3. Test all functionality
4. Confirm everything works

---

**Question for you:**
- What Keycloak client ID should be used for JSON API?
- What scopes are required?
- Or does the JSON API allow unauthenticated access?

Let me know and I'll complete the integration immediately.

Thanks!

