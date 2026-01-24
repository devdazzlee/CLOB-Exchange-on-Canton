# Automatic Synchronizer ID Fetching ✅

## Problem Solved
The synchronizer ID is now **automatically fetched** from the JSON API, so you don't need to manually set `CANTON_SYNCHRONIZER_ID` in your `.env` file.

## How It Works

### 1. Automatic Fetching
The `OnboardingService` now:
- First checks `CANTON_SYNCHRONIZER_ID` env var (manual override)
- If not set, fetches from `/v2/state/connected-synchronizers` API endpoint
- Caches the result in memory for subsequent requests
- Prefers synchronizer with alias `"global"`, falls back to first one

### 2. API Endpoint Used
```
GET /v2/state/connected-synchronizers
```

**Response:**
```json
{
  "connectedSynchronizers": [
    {
      "synchronizerId": "da::1220a1b2c3d4e5f6...",
      "alias": "global",
      "domainId": "..."
    }
  ]
}
```

### 3. Code Changes

**Added to `CantonJsonApiClient`:**
- `getConnectedSynchronizers()` - Fetches all connected synchronizers
- `getGlobalSynchronizerId()` - Returns global synchronizer ID (or first one)

**Updated `OnboardingService`:**
- `getSynchronizerId()` - Smart method that tries env var, then API
- Caches synchronizer ID in memory
- Both `generate-topology` and `allocate` requests now use the same synchronizer

## Usage

### Option 1: Automatic (Recommended)
**No configuration needed!** Just start the server:

```bash
cd apps/api
yarn dev
```

The server will automatically fetch the synchronizer ID on first request.

### Option 2: Manual Override
If you want to set it manually (for testing or specific synchronizer):

```env
# In apps/api/.env
CANTON_SYNCHRONIZER_ID=da::1220a1b2c3d4e5f6...
```

The env var takes precedence over API fetching.

## Testing

### Test the endpoint directly:
```bash
# Get OAuth token first
TOKEN="your-oauth-token"

# Fetch synchronizers
curl -H "Authorization: Bearer $TOKEN" \
  http://65.108.40.104:31539/v2/state/connected-synchronizers | jq
```

### Test your API:
```bash
# No CANTON_SYNCHRONIZER_ID needed in .env!
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"YOUR_BASE64_PUBLIC_KEY"}'
```

Should work automatically! 🎉

## Benefits

✅ **No manual configuration** - Works out of the box
✅ **Always up-to-date** - Fetches latest synchronizer from API
✅ **Fallback support** - Can still use env var if needed
✅ **Cached** - Only fetches once, then uses cached value
✅ **Smart selection** - Prefers "global" synchronizer

## Error Handling

If fetching fails, you'll get a clear error:
```
Failed to get synchronizer ID: <error>. 
Either set CANTON_SYNCHRONIZER_ID in .env or ensure the participant has connected synchronizers.
```

## Status

✅ Automatic fetching implemented
✅ Caching added
✅ Error handling improved
✅ Both requests use synchronizer
✅ Build successful

The `/api/onboarding/allocate-party` endpoint should now work **without** setting `CANTON_SYNCHRONIZER_ID`!
