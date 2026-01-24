# External Party Allocation - Complete Fix ✅

## Problem Summary
The `/api/onboarding/allocate-party` endpoint was returning **400 Bad Request** because:
1. ❌ Using wrong endpoint: `/v2/commands/submit-and-wait` instead of external party endpoints
2. ❌ Missing required fields: `commandId`, `actAs`, `applicationId`
3. ❌ Wrong command structure: should be `{create: {...}}` or `{exercise: {...}}`, not flat
4. ❌ Empty `templateId` and `choice`

## Solution Implemented

### 1. Fixed API Client (`packages/api-clients/src/canton-json-api.ts`)

**Added External Party Endpoints**:
- ✅ `generateExternalPartyTopology()` - Calls `/v2/parties/external/generate-topology`
- ✅ `allocateExternalParty()` - Calls `/v2/parties/external/allocate`
- ✅ Proper TypeScript interfaces for all request/response types

**Fixed V2 Command Structure**:
- ✅ Added `V2SubmitRequest` with required fields
- ✅ Auto-generates `commandId` if missing
- ✅ Defaults `applicationId` to 'clob-exchange-api'
- ✅ Validates `actAs` is present

### 2. Updated Onboarding Service (`apps/api/src/services/onboarding.ts`)

**2-Step Flow**:
- ✅ Step 1: `allocateExternalParty()` - Generates topology, returns `multiHash` to sign
- ✅ Step 2: `completeExternalPartyAllocation()` - Submits signed transactions

**Features**:
- If `signature` provided, completes allocation immediately
- Otherwise returns topology data for frontend signing
- Proper Ed25519 key format handling

### 3. Updated Routes (`apps/api/src/routes/onboarding.ts`)

**Endpoints**:
- ✅ `POST /api/onboarding/allocate-party` - Step 1 (or complete if signature provided)
- ✅ `POST /api/onboarding/complete-allocation` - Step 2 (explicit completion)

**Error Handling**:
- ✅ Logs API error responses
- ✅ Better error messages
- ✅ Development mode details

### 4. Fixed Other Services

**Placeholder Updates**:
- ✅ `faucet.ts` - Marked as requiring template discovery
- ✅ `orders.ts` - Marked as requiring template discovery
- ✅ `external-party.ts` - Deprecated (use OnboardingService instead)

## API Usage

### Step 1: Generate Topology
```bash
POST /api/onboarding/allocate-party
Content-Type: application/json

{
  "publicKey": "base64-encoded-ed25519-public-key",
  "partyHint": "alice"  // optional
}
```

**Response:**
```json
{
  "partyId": "party::...",
  "multiHash": "base64-encoded-hash-to-sign",
  "onboardingTransactions": ["base64-tx1", "base64-tx2"]
}
```

### Step 2: Frontend Signs (in browser)
```typescript
import { signMessage } from '@clob-exchange/crypto';

const multiHashBytes = Buffer.from(multiHash, 'base64');
const signature = await signMessage(multiHashBytes, privateKey);
const signatureBase64 = Buffer.from(signature).toString('base64');
```

### Step 3: Complete Allocation
```bash
POST /api/onboarding/complete-allocation
Content-Type: application/json

{
  "onboardingTransactions": [...],
  "multiHash": "...",
  "signature": "base64-encoded-signature",
  "publicKey": "base64-encoded-public-key"
}
```

**Response:**
```json
{
  "partyId": "party::..."
}
```

## Status

✅ External party endpoints implemented
✅ 2-step flow implemented
✅ Proper error handling
✅ TypeScript types complete
✅ Build successful
✅ Other services marked for template discovery

## Next Steps

1. **Test the endpoint** - Should now return topology data instead of 400
2. **Implement frontend signing** - Sign `multiHash` with private key
3. **Complete allocation** - Call `/complete-allocation` with signature
4. **Template discovery** - Discover template IDs for orders, faucet, etc.

The `/api/onboarding/allocate-party` endpoint should now work correctly! 🎉
