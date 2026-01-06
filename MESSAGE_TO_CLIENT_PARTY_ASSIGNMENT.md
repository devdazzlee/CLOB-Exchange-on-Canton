# Message to Client - Party Assignment Issue

---

Hi,

The party creation endpoint is working and generating tokens successfully. However, when using the token to query Canton, we're getting a 403 error because the token doesn't have the party in the `actAs` claim.

**Current Status:**
- ✅ Party creation endpoint works (`/api/create-party` returns token)
- ✅ Token is generated for validator-operator user
- ❌ Token doesn't include party in `actAs` claim
- ❌ `/v1/user/rights/grant` endpoint returns 404 (not available via JSON API)

**The Issue:**
The token we're generating is a service account token for validator-operator, but it doesn't include the party permissions. When Canton tries to verify the token, it looks up the validator-operator user's rights and doesn't find the party assigned.

**Solution Options:**

**Option 1: Manual Assignment (Recommended for now)**
Since the UserManagementService endpoint isn't available via JSON API, you'll need to assign the party to validator-operator manually using your admin tools. The party ID is: `8100b2db-86cf-40a1-8351-55483c151cdc::cf562e568bcbd9e57fa8b0f405cd6f59f67462ca967311424b06d50d83949f47`

**Option 2: Configure Keycloak Protocol Mapper**
Add a protocol mapper to the validator-app client in Keycloak that dynamically includes the party in the `actAs` claim. This would require configuring Keycloak to read the party from a user attribute or request parameter.

**Option 3: Use Token Exchange**
Implement token exchange in the backend to add the party claim to the token after generation.

Which approach would you prefer? For now, can you manually assign the party to validator-operator so we can test if that resolves the 403 error?

Thanks!

---

