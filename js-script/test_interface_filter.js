/**
 * Test InterfaceFilter with exact payload format from client
 */

require('dotenv').config({ path: './backend/.env' });
const tokenProvider = require('../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";
const CANTON_API = "http://65.108.40.104:31539";

async function main() {
  console.log("Testing InterfaceFilter with exact client payload format...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Get ledger end offset
  const offsetRes = await fetch(`${CANTON_API}/v2/state/ledger-end`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const offsetData = await offsetRes.json();
  const offset = offsetData.offset || "750884";
  
  console.log(`Using offset: ${offset}`);
  console.log(`Party ID: ${PARTY_ID.substring(0, 50)}...`);
  console.log(`Interface ID: #splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding\n`);
  
  // Exact payload format from client
  const payload = {
    "verbose": false,
    "activeAtOffset": offset,
    "filter": {
      "filtersByParty": {
        [PARTY_ID]: {
          "cumulative": [
            {
              "identifierFilter": {
                "InterfaceFilter": {
                  "value": {
                    "includeCreatedEventBlob": true,
                    "interfaceId": "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding",
                    "includeInterfaceView": true
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
  
  console.log("Sending request...");
  const res = await fetch(`${CANTON_API}/v2/state/active-contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  
  const result = await res.json();
  
  if (!res.ok) {
    console.error("❌ Error:", result);
    return;
  }
  
  console.log(`✅ Success!`);
  console.log(`Found ${result.activeContracts?.length || 0} contracts\n`);
  
  if (result.activeContracts && result.activeContracts.length > 0) {
    const first = result.activeContracts[0];
    console.log("First contract:");
    console.log(`  Contract ID: ${first.contractId || first.contractEntry?.JsActiveContract?.createdEvent?.contractId}`);
    console.log(`  Template ID: ${first.templateId || first.contractEntry?.JsActiveContract?.createdEvent?.templateId}`);
    
    const payload = first.payload || first.contractEntry?.JsActiveContract?.createdEvent?.createArgument || {};
    const payloadStr = JSON.stringify(payload).toUpperCase();
    
    if (payloadStr.includes('CBTC')) {
      console.log(`\n✅✅✅ FOUND CBTC HOLDING!`);
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
    } else {
      console.log(`Payload (first 200 chars):`, JSON.stringify(payload).substring(0, 200));
    }
  }
}

main().catch(console.error);
