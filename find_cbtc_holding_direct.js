/**
 * DIRECT APPROACH: Find CBTC Holding Template ID
 * 
 * Since you have CBTC in your account (7,451.4011847037 CC shown in UI),
 * you must have Holding contracts. Let's find them directly!
 */

const fetch = require('node-fetch');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";
const CANTON_API = "http://65.108.40.104:31539";

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

async function getPackages(token) {
  const response = await fetch(`${CANTON_API}/v2/packages`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const data = await response.json();
  return data.packageIds || [];
}

async function queryHoldings(token, templateId) {
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
      pageSize: 100
    })
  });
  
  if (!response.ok) {
    return [];
  }
  
  const data = await response.json();
  return data.activeContracts || [];
}

async function main() {
  console.log("=".repeat(70));
  console.log("FINDING CBTC HOLDING TEMPLATE ID");
  console.log("=".repeat(70));
  console.log("\nSearching for Splice Holding contracts with CBTC...\n");
  
  const token = await getToken();
  const packages = await getPackages(token);
  
  console.log(`Testing ${packages.length} packages...`);
  console.log("This will take about 30-60 seconds...\n");
  
  const holdingPatterns = [
    'Splice.Api.Token.HoldingV1:Holding',
    'Splice.Api.Token:Holding',
  ];
  
  let found = false;
  let tested = 0;
  
  for (const pkg of packages) {
    for (const pattern of holdingPatterns) {
      const templateId = `${pkg}:${pattern}`;
      tested++;
      
      if (tested % 10 === 0) {
        process.stdout.write(`Tested ${tested}/${packages.length * holdingPatterns.length}...\r`);
      }
      
      const contracts = await queryHoldings(token, templateId);
      
      if (contracts.length > 0) {
        // Check for CBTC
        let totalCbtc = 0;
        let cbtcContracts = 0;
        
        for (const contract of contracts) {
          const payload = contract.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
          const payloadStr = JSON.stringify(payload).toUpperCase();
          
          if (payloadStr.includes('CBTC')) {
            cbtcContracts++;
            const amount = parseFloat(payload.amount || 0);
            totalCbtc += amount;
          }
        }
        
        if (cbtcContracts > 0) {
          console.log('\n' + '='.repeat(70));
          console.log('✅✅✅ FOUND CBTC HOLDING TEMPLATE ID!');
          console.log('='.repeat(70));
          console.log(`\nTemplate ID:`);
          console.log(templateId);
          console.log(`\nFound ${cbtcContracts} CBTC Holding contracts`);
          console.log(`Total CBTC: ${totalCbtc.toFixed(8)}`);
          
          // Show sample contract
          const sampleContract = contracts.find(c => {
            const p = c.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
            return JSON.stringify(p).toUpperCase().includes('CBTC');
          });
          
          if (sampleContract) {
            const payload = sampleContract.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
            console.log('\nSample CBTC Holding contract payload:');
            console.log(JSON.stringify(payload, null, 2));
          }
          
          console.log('\n' + '='.repeat(70));
          console.log('UPDATE YOUR CODE:');
          console.log('='.repeat(70));
          console.log('\n1. In your holdingService.js, add this constant:');
          console.log(`\nconst SPLICE_CBTC_TEMPLATE_ID = "${templateId}";`);
          console.log('\n2. Replace the discovery logic with:');
          console.log(`\nconst spliceHoldings = await cantonService.queryActiveContracts({`);
          console.log(`  party: partyId,`);
          console.log(`  templateIds: [SPLICE_CBTC_TEMPLATE_ID],`);
          console.log(`}, token);`);
          console.log('\n3. Calculate balance from contracts:');
          console.log(`\nlet totalCbtc = 0;`);
          console.log(`for (const contract of spliceHoldings) {`);
          console.log(`  const payload = contract.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};`);
          console.log(`  const amount = parseFloat(payload.amount || 0);`);
          console.log(`  totalCbtc += amount;`);
          console.log(`}`);
          console.log(`return { cbtc: totalCbtc };`);
          console.log('\n' + '='.repeat(70));
          
          found = true;
          break;
        }
      }
    }
    if (found) break;
  }
  
  if (!found) {
    console.log('\n❌ CBTC Holding template not found');
    console.log('\nPossible reasons:');
    console.log('1. The pattern might be different (not Splice.Api.Token.HoldingV1:Holding)');
    console.log('2. CBTC might be in a different template');
    console.log('3. You might need to accept the TransferOffer first');
    console.log('\nTry running: node find_transfer_offer.js');
  }
}

main().catch(console.error);
