# Package ID and Party ID - How They Work

## 📋 SUMMARY

### ✅ **Party ID** - Comes from Logged-In User
- **Source**: User's wallet (derived from public key)
- **When**: Automatically available when user logs in
- **How**: `publicKeyToPartyId()` function converts wallet public key to party ID
- **Current Status**: ✅ Already implemented and working

### ⚠️ **Package ID** - Needs to be Obtained
- **Source**: Deployed DAR file on the ledger
- **When**: After DAR is deployed to Canton
- **How**: Can be queried from ledger or extracted from DAR
- **Current Status**: ⚠️ Not yet implemented (using unqualified template IDs)

---

## 1️⃣ PARTY ID (Already Working ✅)

### How It Works

**Party ID comes from the logged-in user's wallet:**

```javascript
// In App.jsx
const wallet = loadWallet();
const partyId = publicKeyToPartyId(wallet.publicKey);
// Result: "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"
```

**Flow:**
1. User creates/imports wallet → Gets public key
2. `publicKeyToPartyId()` converts public key → Party ID
3. Party ID is passed to `TradingInterface` component
4. All API calls use this party ID automatically

**Current Implementation:**
- ✅ `frontend/src/wallet/keyManager.js` - `publicKeyToPartyId()` function
- ✅ `frontend/src/App.jsx` - Derives party ID from wallet
- ✅ `frontend/src/components/TradingInterface.jsx` - Receives `partyId` as prop

**No action needed** - Party ID is already working!

---

## 2️⃣ PACKAGE ID (Needs Implementation ⚠️)

### Current Problem

**The code uses unqualified template IDs:**
```javascript
// Current (WRONG - missing package ID)
queryContracts('UserAccount:UserAccount', partyId)
queryContracts('Order:Order', partyId)
queryContracts('OrderBook:OrderBook', partyId)
```

**Should be fully qualified:**
```javascript
// Correct (with package ID)
queryContracts('<PACKAGE_ID>:UserAccount:UserAccount', partyId)
queryContracts('<PACKAGE_ID>:Order:Order', partyId)
queryContracts('<PACKAGE_ID>:OrderBook:OrderBook', partyId)
```

### How to Get Package ID

#### Option 1: Query from Ledger (Recommended)

After deploying the DAR, query any contract and extract the package ID from the `templateId`:

```javascript
/**
 * Get package ID from deployed contracts
 * Queries a known contract and extracts package ID from templateId
 * @param {string} token - JWT authentication token
 * @returns {Promise<string>} Package ID
 */
async function getPackageId(token) {
  // Query any contract (e.g., UserAccount)
  // The response will include fully qualified templateId
  const response = await fetch("/v2/state/active-contracts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      activeAtOffset: "0",
      verbose: false,
      filter: {
        filtersForAnyParty: {
          inclusive: {
            templateIds: ["UserAccount:UserAccount"] // Unqualified - will match any package
          }
        }
      }
    })
  });

  const result = await response.json();
  const contracts = result.activeContracts || [];
  
  if (contracts.length > 0) {
    // Extract package ID from fully qualified templateId
    // Format: <package-id>:UserAccount:UserAccount
    const templateId = contracts[0].templateId;
    const parts = templateId.split(':');
    if (parts.length >= 3) {
      return parts[0]; // Package ID is first part
    }
  }
  
  throw new Error("Could not determine package ID from ledger");
}
```

#### Option 2: Extract from DAR File

```javascript
/**
 * Extract package ID from DAR file metadata
 * Requires DAR file to be accessible (not recommended for production)
 */
async function getPackageIdFromDar() {
  // This would require parsing the DAR file
  // Not recommended - better to query from ledger
}
```

#### Option 3: Store as Configuration

```javascript
// In .env or config file
VITE_CANTON_PACKAGE_ID=your-package-id-here

// In code
const PACKAGE_ID = import.meta.env.VITE_CANTON_PACKAGE_ID;
```

---

## 3️⃣ IMPLEMENTATION PLAN

### Step 1: Add Package ID Helper Function

Add to `frontend/src/services/cantonApi.js`:

```javascript
/**
 * Get package ID from deployed contracts
 * Queries the ledger to extract package ID from templateId
 * @returns {Promise<string>} Package ID
 */
export async function getPackageId() {
  try {
    // Query with unqualified template ID
    // Ledger will return fully qualified templateId
    const requestBody = {
      activeAtOffset: "0",
      verbose: false,
      filter: {
        filtersForAnyParty: {
          inclusive: {
            templateIds: ["UserAccount:UserAccount"]
          }
        }
      }
    };

    const headers = getHeaders();
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/state/active-contracts`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Failed to query package ID: ${response.statusText}`);
    }

    const result = await response.json();
    const contracts = result.activeContracts || [];
    
    if (contracts.length > 0) {
      // Extract package ID from fully qualified templateId
      // Format: <package-id>:<module>:<template>
      const templateId = contracts[0].templateId;
      const parts = templateId.split(':');
      if (parts.length >= 3) {
        const packageId = parts[0];
        console.log('[API] Package ID detected:', packageId);
        return packageId;
      }
    }
    
    // If no contracts found, try with OrderBook
    // (OrderBook might exist even if UserAccount doesn't)
    const orderBookRequest = {
      activeAtOffset: "0",
      verbose: false,
      filter: {
        filtersForAnyParty: {
          inclusive: {
            templateIds: ["OrderBook:OrderBook"]
          }
        }
      }
    };

    const orderBookResponse = await fetch(`${CANTON_API_BASE}/${API_VERSION}/state/active-contracts`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(orderBookRequest)
    });

    if (orderBookResponse.ok) {
      const orderBookResult = await orderBookResponse.json();
      const orderBookContracts = orderBookResult.activeContracts || [];
      if (orderBookContracts.length > 0) {
        const templateId = orderBookContracts[0].templateId;
        const parts = templateId.split(':');
        if (parts.length >= 3) {
          const packageId = parts[0];
          console.log('[API] Package ID detected from OrderBook:', packageId);
          return packageId;
        }
      }
    }
    
    throw new Error("Could not determine package ID. Ensure contracts are deployed.");
  } catch (error) {
    console.error('[API] Error getting package ID:', error);
    throw error;
  }
}
```

### Step 2: Cache Package ID

Add package ID caching to avoid repeated queries:

```javascript
let cachedPackageId = null;

export async function getPackageId(forceRefresh = false) {
  if (cachedPackageId && !forceRefresh) {
    return cachedPackageId;
  }
  
  // ... query logic from Step 1 ...
  
  cachedPackageId = packageId;
  return packageId;
}
```

### Step 3: Update Template ID Usage

Update all functions to use fully qualified template IDs:

```javascript
// Helper function to qualify template IDs
function qualifyTemplateId(templateId, packageId) {
  // If already qualified, return as-is
  if (templateId.includes(':') && templateId.split(':').length >= 3) {
    return templateId;
  }
  
  // Otherwise, qualify it
  // templateId format: "Module:Template" or "Template"
  const parts = templateId.split(':');
  if (parts.length === 2) {
    // "Module:Template" -> "<package-id>:Module:Template"
    return `${packageId}:${templateId}`;
  } else {
    // "Template" -> "<package-id>:Module:Template" (assume module name = template name)
    return `${packageId}:${templateId}:${templateId}`;
  }
}

// Update queryContracts to use qualified template IDs
export async function queryContracts(templateId, party = null) {
  const packageId = await getPackageId();
  const qualifiedTemplateId = qualifyTemplateId(templateId, packageId);
  
  // ... rest of function ...
}
```

---

## 4️⃣ QUICK FIX (Temporary Solution)

If you need a quick fix before implementing the full solution:

### Option A: Hardcode Package ID (Development Only)

```javascript
// In frontend/src/services/cantonApi.js
const PACKAGE_ID = import.meta.env.VITE_CANTON_PACKAGE_ID || 'YOUR_PACKAGE_ID_HERE';

// Update template IDs
function qualifyTemplateId(templateId) {
  if (templateId.includes(':') && templateId.split(':').length >= 3) {
    return templateId; // Already qualified
  }
  return `${PACKAGE_ID}:${templateId}`;
}
```

### Option B: Use Environment Variable

```bash
# In .env file
VITE_CANTON_PACKAGE_ID=your-actual-package-id-here
```

Then in code:
```javascript
const PACKAGE_ID = import.meta.env.VITE_CANTON_PACKAGE_ID;
```

---

## 5️⃣ HOW TO GET YOUR ACTUAL PACKAGE ID

### Method 1: Query Ledger After Deployment

```bash
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v2/state/active-contracts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "activeAtOffset": "0",
    "verbose": false,
    "filter": {
      "filtersForAnyParty": {
        "inclusive": {
          "templateIds": ["UserAccount:UserAccount"]
        }
      }
    }
  }'
```

**Response will include:**
```json
{
  "activeContracts": [
    {
      "templateId": "YOUR_PACKAGE_ID_HERE:UserAccount:UserAccount",
      ...
    }
  ]
}
```

Extract `YOUR_PACKAGE_ID_HERE` from the `templateId`.

### Method 2: Check DAR Upload Response

When you upload the DAR, the response may include package information:

```bash
./scripts/upload-dar.sh
```

Check the response for package ID.

### Method 3: Use Canton Console

```bash
# Connect to Canton console
# Query packages
packages.list
```

---

## ✅ SUMMARY

| Item | Source | Status | Action Needed |
|------|--------|--------|--------------|
| **Party ID** | Logged-in user's wallet | ✅ Working | None - already implemented |
| **Package ID** | Deployed DAR / Ledger | ⚠️ Missing | Implement `getPackageId()` function |

**Next Steps:**
1. Implement `getPackageId()` function to query from ledger
2. Update all template IDs to use fully qualified format
3. Cache package ID to avoid repeated queries
4. Test with actual deployed contracts


