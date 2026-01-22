# Synchronizer Field Fix ✅

## Problem
The `/v2/parties/external/generate-topology` endpoint was returning 400 with:
```
"Invalid value for: body (Missing required field at 'synchronizer')"
```

## Root Cause
The request body was missing the required `synchronizer` field. The API requires:
```json
{
  "synchronizer": { "id": "global-domain::..." },
  "partyHint": "...",
  "publicKey": { ... }
}
```

## Solution Applied

### 1. Updated TypeScript Interfaces (`packages/api-clients/src/canton-json-api.ts`)

**Changed**:
- `synchronizerId?: string` → `synchronizer: { id: string }` (required)
- Updated `AllocateExternalPartyRequest` to include optional `synchronizer`

### 2. Updated Onboarding Service (`apps/api/src/services/onboarding.ts`)

**Added**:
- Reads `CANTON_SYNCHRONIZER_ID` from config
- Includes `synchronizer: { id: ... }` in topology request
- Includes synchronizer in allocation request

**Error Handling**:
- Throws clear error if `CANTON_SYNCHRONIZER_ID` is missing
- Provides guidance on how to get it

### 3. Updated Configuration (`apps/api/src/config.ts`)

**Added**:
- `synchronizerId: process.env.CANTON_SYNCHRONIZER_ID`

### 4. Updated `.env.example`

**Added**:
- `CANTON_SYNCHRONIZER_ID=global-domain::YOUR_SYNCHRONIZER_ID_HERE`
- Instructions on how to get it

## How to Get Synchronizer ID

### Option 1: Canton Console
```bash
# Connect to Canton console
participant.synchronizers.id_of("global")
# Returns: global-domain::1220a1b2c3d4e5f6...
```

### Option 2: List Connected Synchronizers
```bash
participant.synchronizers.list_connected()
# Find the global synchronizer ID
```

### Option 3: Check Network Documentation
The synchronizer ID is typically provided in the network configuration or documentation.

## Setup

1. **Get Synchronizer ID** from Canton console or network docs

2. **Add to `.env`**:
```env
CANTON_SYNCHRONIZER_ID=global-domain::1220a1b2c3d4e5f6...
```

3. **Restart Server**:
```bash
cd apps/api
yarn dev
```

## Test with curl

```bash
# Set variables
export TOKEN="your-oauth-token"
export SYNCHRONIZER_ID="global-domain::1220..."

# Test the endpoint
curl -X POST 'http://65.108.40.104:31539/v2/parties/external/generate-topology' \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "synchronizer": { "id": "'"$SYNCHRONIZER_ID"'" },
    "partyHint": "",
    "publicKey": {
      "format": "CRYPTO_KEY_FORMAT_RAW",
      "keyData": "16YgznGhHMhWl4JwxICQTxEGaHW/c3VAO8tzb5T+EOA=",
      "keySpec": "SIGNING_KEY_SPEC_EC_CURVE25519"
    }
  }'
```

Should return topology data instead of 400.

## Status

✅ Synchronizer field added to request
✅ Configuration updated
✅ Error handling improved
✅ Documentation updated
✅ Build successful

The `/api/onboarding/allocate-party` endpoint should now work once `CANTON_SYNCHRONIZER_ID` is set!
