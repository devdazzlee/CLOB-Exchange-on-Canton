# External Party Allocation Fix ✅

## Problem
The `/api/onboarding/allocate-party` endpoint was returning 400 because:
1. Using wrong endpoint: `/v2/commands/submit-and-wait` instead of external party endpoints
2. Missing required fields: `commandId`, `actAs`, `applicationId`
3. Wrong command structure: should be `{create: {...}}` or `{exercise: {...}}`, not flat structure
4. Empty `templateId` and `choice`

## Solution Applied

### 1. Updated API Client (`packages/api-clients/src/canton-json-api.ts`)

**Added External Party Endpoints**:
- ✅ `generateExternalPartyTopology()` - Step 1: Generate topology transactions
- ✅ `allocateExternalParty()` - Step 2: Submit signed transactions
- ✅ Proper TypeScript interfaces for request/response

**Fixed V2 Command Structure**:
- ✅ Added `V2SubmitRequest` with required fields:
  - `applicationId` (defaults to 'clob-exchange-api')
  - `commandId` (generated with UUID)
  - `actAs` (array of party IDs)
  - `commands` (typed as `{create: {...}}` or `{exercise: {...}}`)

### 2. Updated Onboarding Service (`apps/api/src/services/onboarding.ts`)

**2-Step Flow Implementation**:
- ✅ Step 1: `allocateExternalParty()` - Generates topology, returns `multiHash` to sign
- ✅ Step 2: `completeExternalPartyAllocation()` - Submits signed transactions

**Key Features**:
- If `signature` is provided in request, completes allocation immediately
- Otherwise, returns `multiHash` and `onboardingTransactions` for frontend to sign
- Proper Ed25519 key format handling

### 3. Updated Routes (`apps/api/src/routes/onboarding.ts`)

**New Endpoints**:
- ✅ `POST /api/onboarding/allocate-party` - Step 1 (or complete if signature provided)
- ✅ `POST /api/onboarding/complete-allocation` - Step 2 (explicit completion)

**Enhanced Error Handling**:
- ✅ Logs API error responses
- ✅ Better error messages
- ✅ Development mode stack traces

## API Flow

### Option A: 2-Step Flow (Recommended)

**Step 1: Generate Topology**
```bash
POST /api/onboarding/allocate-party
{
  "publicKey": "base64-encoded-ed25519-public-key",
  "partyHint": "alice" // optional
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

**Step 2: Frontend Signs multiHash**
```typescript
// Frontend signs the multiHash with private key
const multiHashBytes = Buffer.from(multiHash, 'base64');
const signature = await signMessage(multiHashBytes, privateKey);
const signatureBase64 = Buffer.from(signature).toString('base64');
```

**Step 3: Complete Allocation**
```bash
POST /api/onboarding/complete-allocation
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

### Option B: Single-Step (If Frontend Provides Signature)

```bash
POST /api/onboarding/allocate-party
{
  "publicKey": "base64-encoded-ed25519-public-key",
  "partyHint": "alice",
  "signature": "base64-encoded-signature" // If provided, completes immediately
}
```

## Key Changes

1. **Removed incorrect `/v2/commands/submit-and-wait` usage** for external party allocation
2. **Added proper external party endpoints**: `/v2/parties/external/generate-topology` and `/v2/parties/external/allocate`
3. **Implemented 2-step flow** for secure signing on frontend
4. **Fixed command structure** for future ledger commands (if needed)

## Testing

1. **Test Step 1**:
```bash
curl -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"YOUR_BASE64_PUBLIC_KEY"}'
```

Should return `partyId`, `multiHash`, and `onboardingTransactions`.

2. **Test Step 2** (after signing):
```bash
curl -X POST http://localhost:3001/api/onboarding/complete-allocation \
  -H "Content-Type: application/json" \
  -d '{
    "onboardingTransactions": [...],
    "multiHash": "...",
    "signature": "...",
    "publicKey": "..."
  }'
```

## Status

✅ External party endpoints implemented
✅ 2-step flow implemented
✅ Proper error handling
✅ TypeScript types added
✅ Build successful

The `/api/onboarding/allocate-party` endpoint should now work correctly!
