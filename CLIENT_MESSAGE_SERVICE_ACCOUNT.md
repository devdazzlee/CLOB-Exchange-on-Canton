# Message to Client - Service Account Configuration Required

Hi,

The code is ready, but we need one more Keycloak configuration to enable user creation. The "Direct access grants" is already enabled (thanks!), but we also need to enable **Service Accounts** for the backend to create users.

## Quick Setup (2 minutes):

1. **Keycloak Admin Console** → **Clients** → **"Clob"** client
2. **Settings** tab → Enable **"Service Accounts Enabled"** → **Save**
3. **Service Account Roles** tab → Click **"Assign Role"**
4. Select **"realm-management"** client
5. Assign **"manage-users"** role → **Assign** → **Save**

That's it! After this, the `/api/create-party` endpoint will work and return valid tokens.

**Why this is needed:** The backend needs permission to create users on behalf of your users. Service accounts are the secure, production-ready way to do this.

Let me know once this is done and I'll test it!

Thanks!

