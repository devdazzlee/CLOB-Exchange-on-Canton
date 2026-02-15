/**
 * TEST: Template ID Discovery Problem
 * 
 * This shows exactly what's failing and what we need
 */

const fetch = require('node-fetch');

// ============================================================================
// THE PROBLEM: We need this template ID but don't know it
// ============================================================================

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";
const CANTON_API = "http://65.108.40.104:31539";

// Get admin token
async function getToken() {
  const response = await fetch("https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "Sesnp3u6udkFF983rfprvsBbx3X3mBpw",
      client_secret: "mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYp",
      grant_type: "client_credentials",
      scope: "openid profile email daml_ledger_api"
    })
  });
  const data = await response.json();
  return data.access_token;
}

// ============================================================================
// STRATEGY 1: Try to query ALL contracts (FAILS - 200+ limit)
// ============================================================================

async function testWildcardQuery(token) {
  console.log("\n=== STRATEGY 1: Wildcard Query (FAILS) ===");
  try {
    const response = await fetch(`${CANTON_API}/v2/state/active-contracts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        filter: {
          filtersByParty: {
            [PARTY_ID]: {
              cumulative: [{
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } }
                }
              }]
            }
          }
        },
        activeAtOffset: null,
        pageSize: 200
      })
    });
    
    const text = await response.text();
    if (text.includes('JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED')) {
      console.log("❌ FAILED: 200+ contracts limit reached");
      console.log("   Cannot query all contracts to find CBTC Holdings");
      return false;
    }
    
    const data = JSON.parse(text);
    console.log(`✅ Found ${data.activeContracts?.length || 0} contracts`);
    return true;
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

// ============================================================================
// STRATEGY 2: Try Scan API (FAILS - returns non-JSON)
// ============================================================================

async function testScanAPI(token) {
  console.log("\n=== STRATEGY 2: Scan API (FAILS) ===");
  try {
    const response = await fetch(`http://65.108.40.104:8088/api/scan/v0/holdings/${encodeURIComponent(PARTY_ID)}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      console.log(`✅ Scan API returned:`, JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      console.log(`❌ FAILED: Scan API returned non-JSON: ${text.substring(0, 200)}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

// ============================================================================
// STRATEGY 3: Test patterns (SLOW - tests 200+ templates)
// ============================================================================

async function testPatterns(token) {
  console.log("\n=== STRATEGY 3: Pattern Testing (SLOW) ===");
  
  // Get all packages
  const packagesResponse = await fetch(`${CANTON_API}/v2/packages`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const packagesData = await packagesResponse.json();
  const packageIds = packagesData.packageIds || [];
  
  console.log(`Found ${packageIds.length} packages`);
  console.log(`Would test ${packageIds.length} × 4 patterns = ${packageIds.length * 4} templates`);
  console.log(`Estimated time: ${Math.ceil((packageIds.length * 4) / 20) * 2} seconds (batches of 20)`);
  
  // Test first 5 packages as example
  const testPatterns = [
    'Splice.Api.Token.HoldingV1:Holding',
    'Splice.Api.Token.Holding:Holding',
    'Token.HoldingV1:Holding',
    'Token.Holding:Holding',
  ];
  
  let found = false;
  for (const pkgId of packageIds.slice(0, 5)) {
    for (const pattern of testPatterns) {
      const templateId = `${pkgId}:${pattern}`;
      try {
        const response = await fetch(`${CANTON_API}/v2/state/active-contracts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            filter: {
              filtersByParty: {
                [PARTY_ID]: {
                  cumulative: [{
                    identifierFilter: {
                      TemplateFilter: {
                        value: {
                          templateId: templateId,
                          includeCreatedEventBlob: false
                        }
                      }
                    }
                  }]
                }
              }
            },
            activeAtOffset: null,
            pageSize: 10
          })
        });
        
        const data = await response.json();
        if (data.activeContracts && data.activeContracts.length > 0) {
          // Check if any have CBTC
          const hasCbtc = data.activeContracts.some(c => {
            const payload = c.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
            return JSON.stringify(payload).toUpperCase().includes('CBTC');
          });
          
          if (hasCbtc) {
            console.log(`✅✅✅ FOUND: ${templateId}`);
            found = true;
            break;
          } else {
            console.log(`   Template exists but no CBTC: ${templateId.substring(0, 60)}...`);
          }
        }
      } catch (e) {
        // Template doesn't exist, continue
      }
    }
    if (found) break;
  }
  
  if (!found) {
    console.log(`❌ Not found in first 5 packages. Would need to test all ${packageIds.length} packages.`);
  }
  
  return found;
}

// ============================================================================
// THE SOLUTION: Use actual contract ID (WHAT WE NEED)
// ============================================================================

async function testContractLookup(token, contractId) {
  console.log("\n=== SOLUTION: Contract Lookup (WHAT WE NEED) ===");
  
  if (!contractId) {
    console.log("❌ No contract ID provided");
    console.log("   If you have a TransferOffer or CBTC Holding contract ID,");
    console.log("   we can lookup the contract and extract the template ID instantly!");
    return false;
  }
  
  try {
    const response = await fetch(`${CANTON_API}/v2/contracts/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ contractId })
    });
    
    if (!response.ok) {
      console.log(`❌ Contract lookup failed: ${response.status}`);
      return false;
    }
    
    const contract = await response.json();
    const templateId = contract.templateId;
    const payload = contract.payload || contract.argument || {};
    
    console.log(`✅ Found contract:`);
    console.log(`   Template ID: ${templateId}`);
    console.log(`   Payload keys: ${Object.keys(payload).join(', ')}`);
    
    // Check if it's a CBTC Holding
    const payloadStr = JSON.stringify(payload).toUpperCase();
    if (payloadStr.includes('CBTC') && templateId.includes('Holding')) {
      console.log(`✅✅✅ THIS IS A CBTC HOLDING!`);
      console.log(`   Template ID: ${templateId}`);
      console.log(`   Use this template ID to query all CBTC Holdings`);
      return templateId;
    }
    
    // Check if it's a TransferOffer
    if (templateId.includes('TransferOffer')) {
      console.log(`✅ This is a TransferOffer`);
      console.log(`   Extract Holding template ID from payload...`);
      // Try to extract Holding template ID from TransferOffer payload
      // This depends on the TransferOffer structure
    }
    
    return templateId;
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("=".repeat(70));
  console.log("TEMPLATE ID DISCOVERY PROBLEM - DETAILED TEST");
  console.log("=".repeat(70));
  
  const token = await getToken();
  console.log(`✅ Got admin token`);
  
  // Test all strategies
  await testWildcardQuery(token);
  await testScanAPI(token);
  await testPatterns(token);
  
  // Test solution (if contract ID provided)
  const contractId = process.argv[2]; // Pass contract ID as argument
  if (contractId) {
    await testContractLookup(token, contractId);
  } else {
    console.log("\n" + "=".repeat(70));
    console.log("TO SOLVE THIS PROBLEM:");
    console.log("=".repeat(70));
    console.log("1. Get a TransferOffer contract ID from your 'Offered' CBTC transfers");
    console.log("2. Get a CBTC Holding contract ID from Canton UI");
    console.log("3. OR get the template ID directly from Canton UI/Registry");
    console.log("\nThen run: node TEST_TEMPLATE_DISCOVERY.js <contractId>");
    console.log("=".repeat(70));
  }
}

main().catch(console.error);
