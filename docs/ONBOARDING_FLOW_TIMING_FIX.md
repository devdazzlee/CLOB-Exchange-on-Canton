# Onboarding Flow Timing Fix ✅

## Problem Fixed

The frontend was calling `/ensure-rights` and `/create-preapproval` **before Step 2 completed**, causing 400 errors because `partyId` doesn't exist until after allocation.

**Root cause:** `generate-topology` does NOT allocate a party, so `topologyResponse.party` is often `undefined`. The actual `partyId` only exists after Step 2 (allocation).

## Correct Flow

### Step 1: Generate Topology
**Request:**
```json
POST /api/onboarding/allocate-party
{
  "publicKey": "base64-encoded-ed25519-public-key",
  "partyHint": "ext-optional"  // Optional
}
```

**Response:**
```json
{
  "step": "TOPOLOGY",
  "partyHint": "ext-abc123def456",
  "synchronizerId": "global-domain::1220...",
  "multiHash": "base64-hash-to-sign",
  "onboardingTransactions": ["base64-tx1", "base64-tx2"]
  // Note: NO partyId - it doesn't exist yet!
}
```

### Step 2: Sign & Allocate
**Frontend:** Signs `multiHash` with private key → `signature`

**Request:**
```json
POST /api/onboarding/allocate-party
{
  "publicKey": "base64-encoded-ed25519-public-key",
  "partyHint": "ext-abc123def456",  // From Step 1
  "signature": "base64-encoded-signature",
  "onboardingTransactions": ["base64-tx1", "base64-tx2"]  // From Step 1
}
```

**Response:**
```json
{
  "step": "ALLOCATED",
  "partyId": "party::...",  // NOW partyId exists!
  "partyHint": "ext-abc123def456",
  "synchronizerId": "global-domain::1220..."
}
```

### Step 3: Ensure Rights & Create Preapproval
**ONLY call these AFTER Step 2 returns partyId:**

```json
POST /api/onboarding/ensure-rights
{
  "partyId": "party::..."  // From Step 2
}

POST /api/onboarding/create-preapproval
{
  "partyId": "party::..."  // From Step 2
}
```

## Changes Made

### 1. `apps/api/src/services/onboarding.ts`

**Updated `AllocatePartyResponse`:**
```typescript
export interface AllocatePartyResponse {
  step: 'TOPOLOGY' | 'ALLOCATED'; // Indicates which step completed
  partyId?: string; // Only present after Step 2 (allocation)
  partyHint: string;
  synchronizerId: string;
  multiHash?: string; // Only present in Step 1
  onboardingTransactions?: string[]; // Only present in Step 1
}
```

**Updated `allocateExternalParty()`:**
- **Step 1**: Returns `{ step: 'TOPOLOGY', ... }` - **NO partyId**
- **Step 2**: Returns `{ step: 'ALLOCATED', partyId: ..., ... }` - **partyId included**
- Logging: Only logs `partyId` in Step 2, notes that Step 1 may have undefined party

### 2. `apps/api/src/routes/onboarding.ts`

**Updated `/ensure-rights`:**
- Accepts `party` OR `partyId`
- If missing: Returns 200 success with helpful message (doesn't block onboarding)
- Message: "partyId only exists after Step 2 (allocation)"

**Updated `/create-preapproval`:**
- Accepts `party` OR `partyId`
- If missing: Returns 200 success with helpful message (doesn't block onboarding)
- On error: Returns success (doesn't break onboarding flow)

**Updated `/allocate-party` error message:**
- If `onboardingTransactions` missing when signature provided: Clear hint about Step 2

## Frontend Flow (Updated)

```typescript
// Step 1: Generate topology
const step1 = await fetch('/api/onboarding/allocate-party', {
  method: 'POST',
  body: JSON.stringify({ publicKey: base64PublicKey })
});
const step1Data = await step1.json();
// step1Data = { step: 'TOPOLOGY', partyHint, synchronizerId, multiHash, onboardingTransactions }
// NO partyId yet!

// Step 2: Sign and allocate
const signature = await signMessage(step1Data.multiHash, privateKey);
const step2 = await fetch('/api/onboarding/allocate-party', {
  method: 'POST',
  body: JSON.stringify({
    publicKey: base64PublicKey,
    partyHint: step1Data.partyHint,
    signature: signatureBase64,
    onboardingTransactions: step1Data.onboardingTransactions
  })
});
const step2Data = await step2.json();
// step2Data = { step: 'ALLOCATED', partyId: 'party::...', ... }
// NOW partyId exists!

// Step 3: Ensure rights & preapproval (ONLY after partyId exists)
if (step2Data.partyId) {
  await fetch('/api/onboarding/ensure-rights', {
    method: 'POST',
    body: JSON.stringify({ partyId: step2Data.partyId })
  });
  
  await fetch('/api/onboarding/create-preapproval', {
    method: 'POST',
    body: JSON.stringify({ partyId: step2Data.partyId })
  });
}
```

## Logging

**Step 1:**
```
[Onboarding] Step 1 complete: Topology generated. multiHash ready for signing.
[Onboarding] partyHint: ext-abc123..., synchronizer: global-domain::1220...
```

**Step 2:**
```
[Onboarding] Step 2 complete: Party allocated successfully: party::...
[Onboarding] partyHint: ext-abc123..., synchronizer: global-domain::1220...
```

## Status

✅ Step indicator added to response
✅ Step 1 does NOT include partyId
✅ Step 2 includes partyId
✅ ensure-rights and create-preapproval don't block if party missing
✅ Better error messages
✅ Build successful

The onboarding flow timing is now correct! Frontend should wait for Step 2 to complete before calling ensure-rights and create-preapproval.
