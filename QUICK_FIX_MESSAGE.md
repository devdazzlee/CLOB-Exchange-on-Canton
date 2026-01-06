# Quick Message for Client

Hi,

Here's the specific error we're facing:

**Error:** `403 Forbidden` when trying to create users in Keycloak

**Location:** `/api/create-party` endpoint

**Root Cause:** The "Clob" client needs "Service accounts roles" enabled in the Authentication flow section.

**What I can see in your Keycloak UI:**
- ✅ "Direct access grants" is checked (enabled)
- ❌ "Service accounts roles" is **unchecked** (needs to be enabled)

**Quick Fix (2 steps):**

1. **Enable Service Accounts:**
   - Go to Clients → "Clob" → Settings
   - Under "Capability config" → "Authentication flow"
   - **Check the box for "Service accounts roles"**
   - Save

2. **Assign Permission:**
   - Go to "Service Account Roles" tab (appears after step 1)
   - Click "Assign Role"
   - Select "realm-management" client
   - Assign "manage-users" role
   - Save

After this, the backend will be able to create users and generate tokens.

**Test endpoint:** `GET http://localhost:3001/api/test-service-account` (will confirm if configured correctly)

Thanks!

