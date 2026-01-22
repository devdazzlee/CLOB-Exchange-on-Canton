# Party Hint Fix ✅

## Problem Fixed
The `/api/onboarding/allocate-party` endpoint was failing with:
```
"The submitted request has invalid arguments: Party hint is empty"
```

The Canton JSON API requires a **non-empty** `partyHint`, but the code was sending empty strings.

## Changes Made

### 1. Route Handler (`apps/api/src/routes/onboarding.ts`)

**Changed:**
- `partyHint` is now **optional** in the request
- If provided, it's trimmed before passing to service
- Backend will generate one if missing/empty

**Before:**
```typescript
const { publicKey, partyHint, signature } = req.body;
// ... no trimming, could be empty string
```

**After:**
```typescript
const { publicKey, partyHint, signature } = req.body;
// partyHint is optional - trim if provided, backend will generate if missing/empty
const trimmedPartyHint = partyHint ? String(partyHint).trim() : undefined;
```

### 2. Onboarding Service (`apps/api/src/services/onboarding.ts`)

**Added Helper Methods:**

1. **`sanitizePartyHint(input: string): string`**
   - Trims whitespace
   - Replaces invalid chars with "-"
   - Collapses multiple "-"
   - Limits to 64 chars
   - Removes leading/trailing "-"

2. **`generatePartyHint(publicKeyBase64: string): string`**
   - Generates deterministic hint from public key
   - Format: `ext-<first12hex-of-sha256(publicKeyBase64)>`
   - Uses Node.js `crypto` module

3. **`getOrGeneratePartyHint(publicKeyBase64: string, providedHint?: string): string`**
   - If provided, sanitizes it
   - If empty after sanitization, generates from publicKey
   - Always returns non-empty string

**Updated `allocateExternalParty()`:**
- Always ensures `partyHint` is non-empty before sending to API
- Uses `getOrGeneratePartyHint()` to handle all cases
- Added helpful logging: `partyHint` + synchronizer prefix

**Before:**
```typescript
const topologyRequest = {
  synchronizer: synchronizerId,
  partyHint: request.partyHint ?? '', // Could be empty!
  publicKey: { ... }
};
```

**After:**
```typescript
// Ensure partyHint is always non-empty (generate from publicKey if needed)
const partyHint = this.getOrGeneratePartyHint(request.publicKey, request.partyHint);

const topologyRequest = {
  synchronizer: synchronizerId, // STRING (not object)
  partyHint: partyHint, // Always non-empty
  publicKey: { ... }
};

// Log helpful info
const syncPrefix = synchronizerId.substring(0, 20);
console.log(`[Onboarding] Using partyHint: ${partyHint}, synchronizer: ${syncPrefix}...`);
```

### 3. API Client (`packages/api-clients/src/canton-json-api.ts`)

**No changes needed** - Already correctly sends request body unchanged and expects `synchronizer` as string.

## Implementation Details

### Party Hint Generation
```typescript
import crypto from 'crypto';

private generatePartyHint(publicKeyBase64: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(publicKeyBase64)
    .digest('hex')
    .slice(0, 12);
  return `ext-${hash}`;
}
```

### Sanitization
```typescript
private sanitizePartyHint(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')  // Replace invalid chars
    .replace(/-+/g, '-')               // Collapse multiple dashes
    .slice(0, 64)                      // Max length
    .replace(/^-+|-+$/g, '');          // Remove leading/trailing dashes
}
```

## Test Cases

### ✅ Test 1: No partyHint provided
```bash
POST /api/onboarding/allocate-party
{
  "publicKey": "YOUR_BASE64_PUBLIC_KEY"
}
```
**Result:** Generates `ext-<hash>` automatically

### ✅ Test 2: Empty partyHint
```bash
POST /api/onboarding/allocate-party
{
  "publicKey": "YOUR_BASE64_PUBLIC_KEY",
  "partyHint": ""
}
```
**Result:** Generates `ext-<hash>` automatically

### ✅ Test 3: Valid partyHint
```bash
POST /api/onboarding/allocate-party
{
  "publicKey": "YOUR_BASE64_PUBLIC_KEY",
  "partyHint": "alice"
}
```
**Result:** Uses sanitized "alice"

### ✅ Test 4: Invalid chars in partyHint
```bash
POST /api/onboarding/allocate-party
{
  "publicKey": "YOUR_BASE64_PUBLIC_KEY",
  "partyHint": "alice@user#123"
}
```
**Result:** Sanitizes to "alice-user-123"

## Status

✅ Party hint always non-empty
✅ Automatic generation from public key
✅ Sanitization of provided hints
✅ Helpful logging added
✅ Build successful

The `/api/onboarding/allocate-party` endpoint should now work even when `partyHint` is missing or empty!
