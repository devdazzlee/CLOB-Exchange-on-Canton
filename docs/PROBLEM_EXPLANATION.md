# Problem Explanation: Splice Template ID Discovery

## The Core Problem

We need to discover the **Splice Token Standard `Holding` template ID** for CBTC tokens dynamically, but we're stuck because:

1. **We don't know the exact template ID format**
2. **Wildcard queries fail** (Canton's 200+ contract limit)
3. **We're guessing patterns** instead of using actual contract data

---

## What We're Trying To Do

```javascript
// In holdingService.js, line 434-469
async getBalances(partyId, token) {
  // We need to query Splice Holdings for CBTC tokens
  // But we don't know the template ID!
  
  let spliceTemplateId = this.discoveredSpliceTemplateId; // NULL on first run
  
  if (!spliceTemplateId) {
    // Try to discover it by inspecting contracts
    spliceTemplateId = await this.discoverSpliceTemplateIdByInspectingContracts(partyId, token);
    // This function tries multiple strategies but they all fail!
  }
  
  // Once we have template ID, query is simple:
  spliceHoldings = await cantonService.queryActiveContracts({
    party: partyId,
    templateIds: [spliceTemplateId], // We need this!
  }, token);
}
```

---

## Strategy 0: Scan API (FAILS)

```javascript
// Line 52-101 in holdingService.js
try {
  const scanService = getScanService();
  const scanHoldings = await scanService.getHoldings(partyId, token);
  // Expected: { result: [{ templateId: "...", symbol: "CBTC", ... }] }
  // Actual: Error 404 or non-JSON response
} catch (err) {
  console.warn(`Strategy 0 (Scan API) failed: ${err.message}`);
  // FAILS: Scan API endpoint doesn't work or returns wrong format
}
```

**Problem**: 
- Endpoint `http://65.108.40.104:8088/api/scan/v0/holdings/{partyId}` returns non-JSON
- We can't extract template IDs from it

---

## Strategy 1: TransferOffer Inspection (FAILS)

```javascript
// Line 250-350 in holdingService.js
// Try to query TransferOffer contracts and extract Holding template IDs

const transferOfferPatterns = [
  'Splice.Api.Token.HoldingV1:TransferOffer',
  'Splice.Api.Token:TransferOffer',
  // ... more patterns
];

// Test patterns with all packages
for (const pkgId of packageIds.slice(0, 30)) {
  for (const pattern of transferOfferPatterns) {
    const templateId = `${pkgId}:${pattern}`;
    const contracts = await cantonService.queryActiveContracts({
      party: partyId,
      templateIds: [templateId],
    }, token);
    
    // If TransferOffer found, extract Holding template ID from payload
    // But we never find TransferOffer contracts!
  }
}
```

**Problem**:
- We don't know the TransferOffer template ID either!
- We're guessing patterns: `{packageId}:Splice.Api.Token.HoldingV1:TransferOffer`
- If the pattern is wrong, we never find TransferOffers
- Even if we find them, extracting template IDs from payloads is unreliable

---

## Strategy 2: Contract Lookup (FAILS)

```javascript
// Line 200-270 in holdingService.js
// Query known contracts (Orders, custom Holdings) and lookup referenced contract IDs

const customHoldings = await cantonService.queryActiveContracts({
  party: partyId,
  templateIds: ['f552adda6b4c5ed9caa3c943d004c0e727cc29df62e1fdc91b9f1797491f9390:Holding:Holding'],
}, token);

// Extract contract IDs from payloads (64-char hex strings)
const contractIdsToLookup = new Set();
for (const contract of customHoldings) {
  const payloadStr = JSON.stringify(contract.payload);
  const matches = payloadStr.match(/[a-f0-9]{64,}/gi);
  // Try to find contract IDs...
}

// Lookup contracts to find CBTC Holdings
for (const contractId of contractIdsToLookup) {
  const contract = await cantonService.lookupContract(contractId, token);
  // Check if it's a CBTC Holding...
}
```

**Problem**:
- Contract IDs in payloads are not reliable (might be other references)
- We need to lookup many contracts (slow)
- Most contract IDs won't be CBTC Holdings

---

## Strategy 3: Package Pattern Testing (SLOW, MAY FAIL)

```javascript
// Line 103-165 in holdingService.js
// Query ALL packages and test Splice patterns

const packagesResponse = await cantonService.getPackages(token);
const packageIds = packagesResponse.packageIds; // e.g., 50+ packages

// Test pattern: {packageId}:Splice.Api.Token.HoldingV1:Holding
const testPatterns = packageIds.map(pkgId => 
  `${pkgId}:Splice.Api.Token.HoldingV1:Holding`
);

// Test in batches of 20 (parallel)
for (let i = 0; i < testPatterns.length; i += 20) {
  const batch = testPatterns.slice(i, i + 20);
  const results = await Promise.allSettled(
    batch.map(templateId => 
      cantonService.queryActiveContracts({
        party: partyId,
        templateIds: [templateId],
      }, token)
    )
  );
  
  // Check if any contracts have CBTC
  for (const result of results) {
    if (result.value.contracts.length > 0) {
      const hasCbtc = result.value.contracts.some(c => 
        JSON.stringify(c.payload).toUpperCase().includes('CBTC')
      );
      if (hasCbtc) {
        return templateId; // Found it!
      }
    }
  }
}
```

**Problem**:
- **SLOW**: Tests 50+ packages × 4 patterns = 200+ queries
- Takes 30-60 seconds on first run
- **MAY FAIL**: If the pattern is wrong (e.g., `Splice.Api.Token.Holding:Holding` instead of `Splice.Api.Token.HoldingV1:Holding`), we never find it
- **INEFFICIENT**: We're guessing instead of using actual data

---

## Why Wildcard Queries Don't Work

```javascript
// What we WANT to do (but can't):
const allContracts = await cantonService.queryActiveContracts({
  party: partyId,
  templateIds: [], // Wildcard - get ALL contracts
}, token);

// Then filter for CBTC Holdings:
const cbtcHoldings = allContracts.filter(c => 
  JSON.stringify(c.payload).toUpperCase().includes('CBTC')
);

// Extract template ID:
const templateId = cbtcHoldings[0].templateId;
```

**Problem**:
- Canton returns error: `JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED`
- Even with pagination, wildcard queries fail when there are 200+ contracts
- We can't query "all contracts" to find CBTC Holdings

---

## The Real Solution (What We Need)

Instead of guessing patterns, we should use **actual contract data**:

### Option 1: Use TransferOffer Contract ID (BEST)

```javascript
// If you have a TransferOffer contract ID from Canton UI:
const transferOfferContractId = "00a1b2c3..."; // From your "Offered" transfers

// Lookup the contract directly:
const transferOffer = await cantonService.lookupContract(transferOfferContractId, token);

// Extract Holding template ID from payload:
const holdingTemplateId = transferOffer.payload.holding?.templateId || 
                          transferOffer.payload.instrument?.templateId;

// Now query CBTC Holdings:
const cbtcHoldings = await cantonService.queryActiveContracts({
  party: partyId,
  templateIds: [holdingTemplateId],
}, token);
```

### Option 2: Use CBTC Holding Contract ID (BEST)

```javascript
// If you have a CBTC Holding contract ID from Canton UI:
const cbtcHoldingContractId = "00d4e5f6..."; // From your Holdings

// Lookup the contract directly:
const holding = await cantonService.lookupContract(cbtcHoldingContractId, token);

// Extract template ID:
const templateId = holding.templateId; // DONE! No guessing needed.

// Cache it for future queries:
this.discoveredSpliceTemplateId = templateId;
```

### Option 3: Use Template ID from Canton UI (BEST)

```javascript
// If you can see the template ID in Canton UI/Registry:
const templateId = "abc123...:Splice.Api.Token.HoldingV1:Holding";

// Use it directly:
this.discoveredSpliceTemplateId = templateId;

// No discovery needed!
```

---

## Current Status

**What's happening now**:
1. User calls `/api/balance/{partyId}`
2. `getBalances()` tries to discover template ID
3. All strategies fail or are slow
4. CBTC balance shows as `null` because we can't query Splice Holdings

**What we need**:
- A TransferOffer contract ID (from your "Offered" CBTC transfers)
- OR a CBTC Holding contract ID (from Canton UI)
- OR the template ID directly (from Canton UI/Registry)

With any of these, we can solve the problem in **seconds** instead of testing hundreds of patterns.

---

## Code That Would Solve It

```javascript
// In holdingService.js, add a method to accept contract ID:

async discoverSpliceTemplateIdFromContractId(contractId, token) {
  try {
    // Lookup the contract directly
    const contract = await cantonService.lookupContract(contractId, token);
    
    if (!contract) {
      throw new Error(`Contract ${contractId} not found`);
    }
    
    const templateId = contract.templateId;
    const payload = contract.payload || {};
    
    // Check if it's a CBTC Holding
    const hasCbtc = JSON.stringify(payload).toUpperCase().includes('CBTC');
    const isHolding = templateId.includes('Holding');
    
    if (hasCbtc && isHolding) {
      console.log(`✅ Found Splice template ID from contract: ${templateId}`);
      return templateId;
    }
    
    // If it's a TransferOffer, extract Holding template ID from payload
    if (templateId.includes('TransferOffer')) {
      // Extract Holding template ID from TransferOffer payload
      const holdingTemplateId = payload.holding?.templateId || 
                                payload.instrument?.templateId;
      if (holdingTemplateId) {
        console.log(`✅ Found Splice template ID from TransferOffer: ${holdingTemplateId}`);
        return holdingTemplateId;
      }
    }
    
    throw new Error(`Contract ${contractId} is not a CBTC Holding or TransferOffer`);
  } catch (error) {
    console.error(`Failed to discover template ID from contract: ${error.message}`);
    throw error;
  }
}
```

---

## Summary

**The Problem**: We're guessing template IDs instead of using actual contract data.

**Why It Fails**: 
- Wildcard queries don't work (200+ limit)
- Pattern testing is slow and unreliable
- We don't know the exact format

**The Solution**: Use actual contract IDs or template IDs from the contracts you already have.

**What You Need To Provide**:
1. TransferOffer contract ID (from "Offered" CBTC transfers)
2. OR CBTC Holding contract ID (from Canton UI)
3. OR Template ID directly (from Canton UI/Registry)

With any of these, I can solve it in seconds! 🎯
