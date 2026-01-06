# Keycloak Admin REST API Documentation Findings

## Key Endpoints for Our Implementation

### 1. Create User
**Endpoint:** `POST /admin/realms/{realm}/users`
- **Method:** POST
- **Path:** `/admin/realms/{realm}/users`
- **Body:** `UserRepresentation`
- **Response:** 201 Created (or 400, 403, 409)
- **Current Implementation:** ✅ Correct

### 2. Get Service Account User
**Endpoint:** `GET /admin/realms/{realm}/clients/{client-uuid}/service-account-user`
- **Purpose:** Get the user dedicated to the service account
- **Returns:** `UserRepresentation`
- **Use Case:** To get the service account user ID for role assignment

### 3. Assign Client-Level Roles to User
**Endpoint:** `POST /admin/realms/{realm}/users/{user-id}/role-mappings/clients/{client-id}`
- **Method:** POST
- **Path Parameters:**
  - `realm`: realm name (not id!)
  - `user-id`: user id
  - `client-id`: client id (not clientId!)
- **Body:** `RoleRepresentation[]` (array of roles)
- **Response:** 204 No Content (on success)
- **Use Case:** Assign `manage-users` role from `realm-management` client to service account

### 4. Get Client Roles
**Endpoint:** `GET /admin/realms/{realm}/clients/{client-uuid}/roles`
- **Purpose:** Get all roles for a client
- **Use Case:** Find the `manage-users` role in `realm-management` client

## How to Assign manage-users Role to Service Account

### Step-by-Step Process:

1. **Get the service account user:**
   ```
   GET /admin/realms/{realm}/clients/{client-uuid}/service-account-user
   ```
   - Returns the user ID for the service account

2. **Get the realm-management client UUID:**
   ```
   GET /admin/realms/{realm}/clients?clientId=realm-management
   ```
   - Find the client with `clientId` = `realm-management`
   - Get its `id` (UUID)

3. **Get the manage-users role:**
   ```
   GET /admin/realms/{realm}/clients/{realm-management-uuid}/roles/manage-users
   ```
   - Returns the `RoleRepresentation` for `manage-users`

4. **Assign the role to service account user:**
   ```
   POST /admin/realms/{realm}/users/{service-account-user-id}/role-mappings/clients/{realm-management-client-id}
   ```
   - Body: `[{ "id": "...", "name": "manage-users" }]`

## Current Implementation Status

### ✅ What's Working:
- User creation endpoint: `POST /admin/realms/{realm}/users` ✅
- Token authentication ✅
- Error handling ✅

### ❌ What's Missing:
- Service account doesn't have `manage-users` role
- This is a **Keycloak configuration issue**, not a code issue

## Solution

The code is **correct**. The issue is that the `validator-app` service account needs the `manage-users` role assigned in Keycloak.

### Manual Configuration (Required):
1. Go to Keycloak Admin Console
2. Navigate to: **Clients** → **validator-app** (or the client ID from `KEYCLOAK_ADMIN_CLIENT_ID`)
3. Go to **Service Account Roles** tab
4. Click **Assign Role**
5. Select **Filter by clients** → Choose **realm-management**
6. Select **manage-users** role
7. Click **Assign**
8. Save

### Programmatic Solution (Optional):
We could add a helper function to automatically assign the role, but this would require:
- Admin permissions to modify service account roles
- Additional API calls to get client UUIDs and role IDs
- More complexity

**Recommendation:** Manual configuration is simpler and more secure.

## API Endpoints Used in Current Code

### Current Implementation:
```javascript
// Create user
POST /admin/realms/{realm}/users
Body: {
  username: "...",
  enabled: true,
  attributes: { cantonPartyId: "..." }
}

// Check if user exists
GET /admin/realms/{realm}/users?username={username}

// Reset password
PUT /admin/realms/{realm}/users/{user-id}/reset-password

// Update user
PUT /admin/realms/{realm}/users/{user-id}
```

All endpoints are **correct** according to the documentation! ✅

## Error Messages

The current error message is accurate and helpful:
- Clearly states what's missing
- Provides step-by-step instructions
- Shows current token roles for debugging

## Conclusion

**The code is production-ready and correct.** The only issue is the Keycloak configuration - the service account needs the `manage-users` role assigned. This must be done manually in the Keycloak Admin Console.

