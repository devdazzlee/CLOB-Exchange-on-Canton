# Synchronizer String Fix ✅

## Problem Fixed
The API was expecting `synchronizer` as a **STRING**, but the code was sending it as an object `{ id: ... }`, causing:
```
"expecting string at 'synchronizer'"
```

## Changes Made

### 1. Updated TypeScript Types (`packages/api-clients/src/canton-json-api.ts`)

**Changed:**
- `synchronizer: { id: string }` → `synchronizer: string`
- Updated both `GenerateTopologyRequest` and `AllocateExternalPartyRequest`

### 2. Fixed Request Payloads (`apps/api/src/services/onboarding.ts`)

**Before:**
```typescript
{
  synchronizer: { id: synchronizerId }
}
```

**After:**
```typescript
{
  synchronizer: synchronizerId  // STRING directly
}
```

### 3. Implemented Caching (5 minutes TTL)

- Caches synchronizer ID in memory for 5 minutes
- Avoids repeated API calls
- Cache expires and refreshes automatically

### 4. Improved Synchronizer Selection

- Prefers synchronizer with alias `"global"`
- Falls back to one containing `"global-domain"` in ID
- Finally uses first synchronizer if none match

### 5. Enhanced Logging & Security

- **No full OAuth tokens in logs** - Only last 6 characters shown
- Logs synchronizer ID preview (first 20 chars)
- Helpful error messages

### 6. Added Debug Route

**GET `/api/onboarding/synchronizers`**
- Returns list of connected synchronizers
- Useful for verifying environment
- No secrets exposed

## Usage

### Automatic (No Config Needed)
```bash
cd apps/api
yarn dev
```

The server automatically fetches synchronizer ID on first request.

### Manual Override (Optional)
```env
# In apps/api/.env
CANTON_SYNCHRONIZER_ID=global-domain::1220a1b2c3d4e5f6...
```

### Test the Debug Endpoint
```bash
curl http://localhost:3001/api/onboarding/synchronizers
```

Returns:
```json
{
  "connectedSynchronizers": [
    {
      "synchronizerId": "global-domain::1220...",
      "alias": "global",
      "domainId": "..."
    }
  ],
  "count": 1
}
```

## Manual Test Flow

### 1. Acquire OAuth Token
```bash
TOKEN=$(curl -X POST \
  'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'client_id=Sesnp3u6udkFF983rfprvsBbx3X3mBpw' \
  --data-urlencode 'client_secret=YOUR_SECRET' \
  -k | jq -r '.access_token')
```

### 2. Get Connected Synchronizers
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://65.108.40.104:31539/v2/state/connected-synchronizers | jq
```

### 3. Test Allocate Party
```bash
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "YOUR_BASE64_PUBLIC_KEY",
    "partyHint": "alice"
  }'
```

## Status

✅ Synchronizer is now a STRING (not object)
✅ Automatic fetching with 5-minute cache
✅ Improved synchronizer selection logic
✅ Security: No full tokens in logs
✅ Debug route added
✅ Build successful

The `/api/onboarding/allocate-party` endpoint should now work correctly!
