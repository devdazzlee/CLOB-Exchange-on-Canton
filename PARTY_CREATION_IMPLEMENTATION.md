# Party Creation Implementation - No Keycloak Redirect

## Overview

This implementation allows the app to create party IDs on behalf of users without requiring them to have Keycloak credentials or be redirected to Keycloak. The backend handles party creation automatically when a user creates a wallet.

## Changes Made

### Backend Changes

1. **`backend/party-service.js`** (NEW)
   - Service to create party IDs on behalf of users
   - Quota management (daily/weekly limits, configurable via environment variables)
   - Token generation (requires Keycloak admin access)

2. **`backend/server.js`** (UPDATED)
   - Added `/api/create-party` endpoint
   - Added `/api/quota-status` endpoint
   - Integrated party service

### Frontend Changes

1. **`frontend/src/services/partyService.js`** (NEW)
   - Service to call backend API for party creation
   - Handles quota errors gracefully

2. **`frontend/src/components/WalletSetup.jsx`** (UPDATED)
   - Automatically calls backend API after wallet creation
   - Stores authentication token if provided by backend
   - Works for both new wallet creation and wallet import

3. **`frontend/src/components/AuthGuard.jsx`** (UPDATED)
   - No longer redirects to Keycloak
   - Checks for wallet and automatically creates party if needed
   - Shows helpful error messages for quota issues

4. **`frontend/src/wallet/keyManager.js`** (UPDATED)
   - Fixed `publicKeyToPartyId()` to use actual public key (not hardcoded)
   - Exported `bytesToHex()` function for use in other modules

## How It Works

### User Flow

1. **User creates wallet:**
   - User enters password and confirms
   - Wallet is created locally (encrypted with password)
   - Frontend automatically calls `/api/create-party` with public key
   - Backend creates party ID and returns it (with optional token)
   - User can immediately use the app

2. **User accesses trading interface:**
   - `AuthGuard` checks for authentication token
   - If no token but wallet exists, automatically creates party
   - User proceeds without any Keycloak interaction

### Backend Flow

1. **Party Creation:**
   - Receives public key from frontend
   - Checks quota (daily/weekly limits)
   - Creates party ID: `prefix::hex(publicKey)`
   - Attempts to generate JWT token (may fail if Keycloak not configured)
   - Returns party ID and token (if available)

2. **Quota Management:**
   - Tracks daily and weekly party creation counts
   - Default: 5,000 daily, 35,000 weekly
   - Configurable via environment variables

## Configuration

### Environment Variables

**Backend:**
```bash
# Keycloak Configuration
KEYCLOAK_BASE_URL=https://keycloak.wolfedgelabs.com:8443
KEYCLOAK_REALM=canton-devnet
KEYCLOAK_ADMIN_USER=zoya
KEYCLOAK_ADMIN_PASSWORD=Zoya123!
KEYCLOAK_CLIENT_ID=Clob

# Quota Configuration
DAILY_PARTY_QUOTA=5000
WEEKLY_PARTY_QUOTA=35000
```

**Frontend:**
```bash
# API Base URL (optional, defaults to /api in production)
VITE_API_BASE_URL=http://localhost:3001
```

### Keycloak Setup (For Token Generation)

The backend attempts to generate JWT tokens for created parties. This requires:

1. **Admin Access:**
   - Backend needs Keycloak admin credentials
   - Should use a service account, not a regular user account

2. **Token Generation:**
   - Currently uses client credentials grant
   - May need to be updated to use Keycloak's admin API to create users
   - Or use impersonation/token exchange

**Note:** Token generation is optional. If it fails, the party is still created and the user can proceed. Tokens can be generated later if needed.

## API Endpoints

### POST `/api/create-party`

Creates a party ID on behalf of a user.

**Request:**
```json
{
  "publicKeyHex": "122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"
}
```

**Response:**
```json
{
  "partyId": "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292",
  "token": "eyJhbGciOiJSUzI1NiIs...", // Optional, may be null
  "quotaStatus": {
    "dailyUsed": 1,
    "dailyLimit": 5000,
    "weeklyUsed": 1,
    "weeklyLimit": 35000
  }
}
```

**Error Responses:**
- `400`: Invalid public key format
- `429`: Quota exceeded
- `500`: Server error

### GET `/api/quota-status`

Get current quota status.

**Response:**
```json
{
  "daily": {
    "used": 1234,
    "limit": 5000,
    "remaining": 3766
  },
  "weekly": {
    "used": 8765,
    "limit": 35000,
    "remaining": 26235
  }
}
```

## Testing

1. **Start backend:**
   ```bash
   cd backend
   npm install
   node server.js
   ```

2. **Start frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. **Test flow:**
   - Navigate to app
   - Create a new wallet
   - Check browser console for party creation logs
   - Verify party ID is displayed
   - Try accessing trading interface

## Important Notes

1. **Token Generation:**
   - Token generation may fail if Keycloak admin API is not properly configured
   - This is okay - the party is still created
   - Users can still use the app, tokens can be generated later

2. **Quota Management:**
   - Currently uses in-memory storage
   - For production, use Redis or database
   - Quota resets daily/weekly automatically

3. **Security:**
   - Backend should use service account credentials, not user credentials
   - Admin password should be stored securely (environment variables, secrets manager)
   - Consider rate limiting on the API endpoint

4. **Production Considerations:**
   - Implement proper token generation using Keycloak admin API
   - Use database/Redis for quota tracking
   - Add monitoring and logging
   - Implement proper error handling and retries

## Next Steps

1. **Configure Keycloak Admin API:**
   - Set up service account for backend
   - Configure proper permissions for party creation
   - Test token generation

2. **Improve Token Generation:**
   - Use Keycloak admin API to create users with party IDs
   - Generate proper JWT tokens with correct claims
   - Include `actAs` and `readAs` claims for Canton

3. **Production Deployment:**
   - Move quota tracking to database/Redis
   - Add monitoring and alerting
   - Set up proper logging
   - Configure environment variables securely

