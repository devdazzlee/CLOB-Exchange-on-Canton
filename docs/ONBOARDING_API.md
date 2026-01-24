# Canton External Party Onboarding API

This document describes the Canton JSON API v2 external party onboarding flow implemented in this project.

## Overview

External party onboarding uses a **2-step flow** with Canton's JSON API v2:

1. **Step 1: Generate Topology** - Get multiHash and topology transactions for signing
2. **Step 2: Allocate Party** - Submit signature to complete party allocation

## Prerequisites

- Canton JSON API v2 endpoint: `http://65.108.40.104:31539`
- OAuth client credentials (validator-app) with `ledger-api` scope
- User wallet with Ed25519 key pair

## API Endpoints

### 1. Discover Synchronizer ID

Get the synchronizer ID for the Canton network.

**Endpoint:** `GET /api/onboarding/discover-synchronizer`

**Response:**
```json
{
  "success": true,
  "message": "Synchronizer discovered successfully",
  "data": {
    "synchronizerId": "global-domain::1220abc..."
  }
}
```

---

### 2. Step 1: Generate Topology

Generate topology transactions and multiHash for wallet signature.

**Endpoint:** `POST /api/onboarding/allocate-party`

**Request Body:**
```json
{
  "publicKeyBase64": "base64-encoded-public-key",
  "partyHint": "optional-party-hint"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Topology generated successfully",
  "data": {
    "step": "TOPOLOGY",
    "synchronizerId": "global-domain::1220abc...",
    "partyHint": "ext-a1b2c3d4e5f6",
    "multiHash": "base64-encoded-multihash",
    "publicKeyFingerprint": "fingerprint-string",
    "topologyTransactions": [
      {
        "transaction": "base64-encoded-tx-1"
      },
      {
        "transaction": "base64-encoded-tx-2"
      }
    ],
    "onboardingTransactions": [
      {
        "transaction": "base64-encoded-tx-1"
      },
      {
        "transaction": "base64-encoded-tx-2"
      }
    ],
    "partyId": "optional-party-id"
  }
}
```

**Notes:**
- `partyHint` is optional. If not provided, backend auto-generates one from publicKey hash.
- Both `topologyTransactions` and `onboardingTransactions` are returned (same data, different keys for compatibility).
- `multiHash` must be signed by the wallet's Ed25519 private key.
- **DO NOT call this endpoint multiple times** - save the result and reuse for step 2.

---

### 3. Step 2: Allocate Party

Submit wallet signature to complete party allocation.

**Endpoint:** `POST /api/onboarding/allocate-party`

**Request Body:**
```json
{
  "publicKeyBase64": "base64-encoded-public-key",
  "signatureBase64": "base64-encoded-signature",
  "topologyTransactions": [
    {
      "transaction": "base64-encoded-tx-1"
    },
    {
      "transaction": "base64-encoded-tx-2"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Party allocated successfully",
  "data": {
    "step": "ALLOCATED",
    "partyId": "party-id::hash",
    "synchronizerId": "global-domain::1220abc..."
  }
}
```

**Notes:**
- Use `topologyTransactions` from step 1 response (or `onboardingTransactions`, both work).
- `signatureBase64` is Ed25519 signature of the `multiHash` from step 1.
- **This completes the onboarding process** - save `partyId` for ledger operations.

---

### 4. Ensure Rights (Optional)

Verify party rights. This is a **NO-OP** in the current implementation because the validator token already has `actAs` rights for all parties.

**Endpoint:** `POST /api/onboarding/ensure-rights`

**Request Body:**
```json
{
  "partyId": "party-id::hash"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Rights verification successful",
  "data": {
    "success": true,
    "message": "Rights verification skipped (validator token has actAs)"
  }
}
```

---

### 5. Create Preapproval (Optional)

Create preapproval for party. This is **optional and not required** for onboarding.

**Endpoint:** `POST /api/onboarding/create-preapproval`

**Request Body:**
```json
{
  "partyId": "party-id::hash"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Preapproval successful",
  "data": {
    "success": true,
    "message": "Preapproval skipped (not required for onboarding)"
  }
}
```

---

## Complete Onboarding Flow Example

### Frontend Implementation

```javascript
import { bytesToBase64, signMessage, decryptPrivateKey } from './wallet/keyManager';
import { generateTopology, allocatePartyWithSignature } from './services/partyService';

async function onboardUser(publicKey, encryptedPrivateKey, password) {
  // Step 1: Generate topology
  const publicKeyBase64 = bytesToBase64(publicKey);
  const topology = await generateTopology(publicKeyBase64, null);

  console.log('Topology generated:', topology);
  // Save topology.multiHash and topology.topologyTransactions

  // Step 2: Unlock wallet and sign
  const privateKey = await decryptPrivateKey(encryptedPrivateKey, password);
  const signatureBase64 = await signMessage(privateKey, topology.multiHash);

  // Step 3: Allocate party
  const result = await allocatePartyWithSignature(
    publicKeyBase64,
    signatureBase64,
    topology.topologyTransactions
  );

  console.log('Party allocated:', result.partyId);

  // Store party ID
  localStorage.setItem('canton_party_id', result.partyId);

  return result;
}
```

### Backend Canton API Calls

The backend makes these Canton API calls:

**Step 1: Generate Topology**
```bash
POST http://65.108.40.104:31539/v2/parties/external/generate-topology
Authorization: Bearer <oauth-token>
Content-Type: application/json

{
  "synchronizer": "global-domain::1220abc...",
  "partyHint": "ext-a1b2c3d4e5f6",
  "publicKey": {
    "format": "CRYPTO_KEY_FORMAT_RAW",
    "keyData": "base64-encoded-public-key",
    "keySpec": "SIGNING_KEY_SPEC_EC_CURVE25519"
  }
}
```

**Step 2: Allocate Party**
```bash
POST http://65.108.40.104:31539/v2/parties/external/allocate
Authorization: Bearer <oauth-token>
Content-Type: application/json

{
  "synchronizer": "global-domain::1220abc...",
  "topologyTransactions": [...],
  "multiHashSignatures": [
    {
      "publicKey": {
        "format": "CRYPTO_KEY_FORMAT_RAW",
        "keyData": "base64-encoded-public-key",
        "keySpec": "SIGNING_KEY_SPEC_EC_CURVE25519"
      },
      "signature": "base64-encoded-signature"
    }
  ]
}
```

---

## Error Handling

### Common Errors

**400 Bad Request** - Client input error
```json
{
  "success": false,
  "error": "publicKeyBase64 is required"
}
```

**502 Bad Gateway** - Canton upstream error
```json
{
  "success": false,
  "error": "Canton upstream error: ...",
  "cause": "upstream error details"
}
```

### Troubleshooting

**"Missing required field at 'format'"**
- This error occurs if publicKey is not properly constructed
- Backend now always constructs publicKey object with correct format
- Ensure you're using the latest onboarding service

**"Party hint is empty"**
- PartyHint is auto-generated if not provided
- Backend ensures partyHint is never empty

**"topologyTransactions not found"**
- Canton sometimes returns `topologyTransactions`, sometimes `onboardingTransactions`
- Backend normalizes both keys - either will work

**Multiple API calls / duplicate requests**
- Frontend uses `useRef` guards to prevent duplicate calls
- React StrictMode no longer causes double-invocations

---

## Configuration

### Backend Environment Variables

```bash
# Canton JSON API v2
CANTON_JSON_API_BASE=http://65.108.40.104:31539

# Canton OAuth (validator-app client)
CANTON_OAUTH_TOKEN_URL=https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token
CANTON_OAUTH_CLIENT_ID=Sesnp3u6udkFF983rfprvsBbx3X3mBpw
CANTON_OAUTH_CLIENT_SECRET=<secret>

# Optional: Override synchronizer ID
# CANTON_SYNCHRONIZER_ID=global-domain::1220abc...
```

### OAuth Token Requirements

The OAuth token must include:
- **Scope**: `openid profile email daml_ledger_api`
- **Grant type**: `client_credentials`
- **Claim**: Token must have `ledger-api` claim for `actAs` rights

---

## Security Considerations

1. **Never expose client secret** - Keep `CANTON_OAUTH_CLIENT_SECRET` in backend env only
2. **Signature verification** - Canton verifies Ed25519 signatures on allocation
3. **Token caching** - Backend caches OAuth tokens with 5-minute buffer before expiry
4. **Rate limiting** - Consider adding rate limiting to prevent abuse
5. **Synchronizer ID caching** - Cached for 5 minutes to reduce discovery calls

---

## Admin Orderbook Creation

After users complete onboarding, they need access to a **global orderbook**. An admin user must create orderbooks for trading pairs.

**Note**: This is a separate flow from onboarding. Users can only trade if orderbooks exist.

---

## Additional Resources

- [Canton JSON API v2 Documentation](https://docs.daml.com/canton/usermanual/apis.html)
- [Ed25519 Signature Scheme](https://ed25519.cr.yp.to/)
- [OAuth 2.0 Client Credentials Flow](https://oauth.net/2/grant-types/client-credentials/)
