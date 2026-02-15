# Template Issue Explanation

## The Problem

**Template ID Format Provided:**
```
splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding
```

**What This Means:**
- `splice-api-token-holding-v1` = Package NAME (human-readable identifier)
- `Splice.Api.Token.HoldingV1` = Module name
- `Holding` = Template name

**What Canton API Actually Needs:**
```
<64-character-hex-package-id>:Splice.Api.Token.HoldingV1:Holding
```

For example:
```
a1b2c3d4e5f6...xyz:Splice.Api.Token.HoldingV1:Holding
```

## Why This Is A Problem

1. **Package Name vs Package ID:**
   - Package NAME: `splice-api-token-holding-v1` (human-readable)
   - Package ID: `a1b2c3d4e5f6...` (64-character hex string, unique identifier)

2. **Canton API Requirement:**
   - The JSON Ledger API v2 requires the actual package ID (hex string)
   - It does NOT accept package names
   - When we query with package name, we get: `"Templates do not exist"` error

3. **Current Behavior:**
   - We query: `splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding`
   - Canton returns: `"Templates do not exist"`
   - Result: Cannot find CBTC Holdings

## What We've Tried

1. **Direct Query:** Querying with package name → Fails
2. **Package Discovery:** Testing all 223 packages to find the one with Splice templates → Takes too long, hasn't found it yet
3. **TransferOffer Inspection:** Looking for TransferOffer contracts to extract package ID → Haven't found them

## What We Need

**Option 1: Package ID (Best)**
- The actual 64-character hex package ID for `splice-api-token-holding-v1`
- Can be found in:
  - Utilities UI → Registry → Packages → Find `splice-api-token-holding-v1` → Copy Package ID
  - Or from a contract that uses this package (check contract details)

**Option 2: Contract ID (Alternative)**
- Contract ID from the "Executed" transfer
- We can lookup the contract and extract the template ID (which includes package ID)

**Option 3: Transfer-Preapproval (Future)**
- As you mentioned, we can create Transfer-Preapproval contracts for automatic acceptance
- But first, we need to find the correct package ID to query existing Holdings

## Example of What We Need

If you can check Utilities UI:
1. Go to Registry → Packages
2. Find package named `splice-api-token-holding-v1`
3. Copy the Package ID (should be a long hex string like `a1b2c3d4e5f6...`)

Then we can use:
```
<a1b2c3d4e5f6...>:Splice.Api.Token.HoldingV1:Holding
```

## Current Status

- Code is ready to query Splice Holdings
- System will automatically detect CBTC once we have correct package ID
- Both "Offered" and "Executed" transfers will show once package ID is resolved
