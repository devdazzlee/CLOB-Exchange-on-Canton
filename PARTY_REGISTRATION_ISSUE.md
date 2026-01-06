# Party Registration Issue

## Problem

When creating a new party ID via `/api/create-party`, the response includes:
- ✅ Party ID created successfully
- ✅ Token generated (using fallback service token)
- ❌ **But the party is not registered in Canton**

When trying to use this party ID to query contracts, you get:
```json
{
    "code": "NA",
    "cause": "A security-sensitive error has been received",
    "grpcCodeValue": 16
}
```

This error (grpcCodeValue 16 = UNAUTHENTICATED) occurs because:
1. The party ID exists as a string, but is not registered on the Canton ledger
2. Canton requires parties to be registered before they can be used in queries/commands
3. Even with a valid token, unregistered parties cannot access the ledger

## Current Solution

The backend now:
1. Creates the party ID string (format: `prefix::hex(publicKey)`)
2. Returns a service token with `can_read_as` permissions
3. **But the party still needs to be registered in Canton**

## How to Fix

### Option 1: Register Party via Canton Admin API (Recommended)

You need to register the party using Canton's admin API. This requires:
- Admin access to Canton
- gRPC or HTTP API access to the participant node

Example (using Canton console or admin API):
```bash
# Register the party
participant.parties.allocate("8100b2db-86cf-40a1-8351-55483c151cdc::e435c27d374d1932f8914471384dbc604ae5ff4d904b0b37cb0b4ed9935c18ec", "User")
```

### Option 2: Use Existing Registered Party (Temporary)

For now, you can use the existing registered party ID:
```
8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292
```

This party is already registered and has permissions.

### Option 3: Implement Party Registration in Backend

Add a function to register parties automatically:

```javascript
async function registerPartyInCanton(partyId) {
  // Use Canton admin API to register the party
  // This requires admin credentials and gRPC/HTTP access
  const response = await fetch('https://participant.dev.canton.wolfedgelabs.com/admin/parties/allocate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      partyId: partyId,
      displayName: 'User'
    })
  });
  
  return response.ok;
}
```

## Next Steps

1. **Immediate**: Use the existing registered party ID for testing
2. **Short-term**: Implement party registration in the backend
3. **Long-term**: Set up automated party registration workflow

## Testing

To test if a party is registered, try querying contracts:
```bash
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v2/state/active-contracts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "readAs": ["PARTY_ID_TO_TEST"],
    "activeAtOffset": "0",
    "verbose": true,
    "filter": {
      "filtersByParty": {
        "PARTY_ID_TO_TEST": {
          "inclusive": {
            "templateIds": ["UserAccount:UserAccount"]
          }
        }
      }
    }
  }'
```

If you get a security error, the party is not registered.

