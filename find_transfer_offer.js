/**
 * FIND TRANSFER OFFER CONTRACTS
 * 
 * Finds your CBTC TransferOffer contracts and gives you the contract ID
 * to use with lookup_cbtc_contract.js
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

async function queryTransferOffers(token, templateId) {
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
      pageSize: 50
    })
  });
  
  if (!response.ok) {
    return [];
  }
  
  const data = await response.json();
  return data.activeContracts || [];
}

async function findTransferOffers(token) {
  console.log("Searching for TransferOffer contracts...\n");
  
  const packages = await getPackages(token);
  console.log(`Found ${packages.length} packages\n`);
  
  const transferOfferPatterns = [
    'Splice.Api.Token.HoldingV1:TransferOffer',
    'Splice.Api.Token:TransferOffer',
    'Token.HoldingV1:TransferOffer',
  ];
  
  for (const pkg of packages) {
    for (const pattern of transferOfferPatterns) {
      const templateId = `${pkg}:${pattern}`;
      const contracts = await queryTransferOffers(token, templateId);
      
      if (contracts.length > 0) {
        console.log(`✅ Found ${contracts.length} TransferOffer contracts with pattern: ${pattern}\n`);
        
        // Check for CBTC
        for (const contract of contracts) {
          const contractId = contract.contractId;
          const payload = contract.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
          const payloadStr = JSON.stringify(payload);
          
          if (payloadStr.toUpperCase().includes('CBTC')) {
            console.log('='.repeat(70));
            console.log('✅ FOUND CBTC TRANSFER OFFER!');
            console.log('='.repeat(70));
            console.log(`Contract ID: ${contractId}`);
            console.log(`Template ID: ${templateId}`);
            console.log('\nPayload snippet:');
            console.log(JSON.stringify(payload, null, 2).substring(0, 500));
            console.log('\n' + '='.repeat(70));
            console.log('NEXT STEP:');
            console.log('='.repeat(70));
            console.log('Run this to get the Holding template ID:');
            console.log(`node lookup_cbtc_contract.js ${contractId}`);
            console.log('='.repeat(70));
            return;
          }
        }
      }
    }
  }
  
  console.log('❌ No CBTC TransferOffer contracts found');
}

async function main() {
  console.log("=".repeat(70));
  console.log("FINDING CBTC TRANSFER OFFER CONTRACT");
  console.log("=".repeat(70));
  console.log("\nThis will search for your CBTC TransferOffer contracts");
  console.log("and give you the contract ID to use with lookup_cbtc_contract.js\n");
  
  const token = await getToken();
  await findTransferOffers(token);
}

main().catch(console.error);
