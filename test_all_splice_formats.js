/**
 * Test all possible Splice template formats to find the correct one
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('./backend/src/services/cantonService');
const tokenProvider = require('./backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("Testing all possible Splice template formats...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Test different template formats
  const formats = [
    "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding",
    "#splice-api-token-holding-v1:Splice.Api.Token:Holding",
    "#splice-api-token-holding-v1:Token.HoldingV1:Holding",
    "#splice-api-token-holding-v1:Holding:Holding",
    "splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding", // without #
  ];
  
  for (const templateId of formats) {
    console.log(`Testing: ${templateId}`);
    try {
      const contracts = await cantonService.queryActiveContracts({
        party: PARTY_ID,
        templateIds: [templateId],
      }, token);
      
      if (contracts.length > 0) {
        console.log(`✅ FOUND ${contracts.length} contracts with this format!`);
        
        // Check for CBTC
        for (const contract of contracts) {
          const payload = contract.payload || contract.createArgument || {};
          const payloadStr = JSON.stringify(payload).toUpperCase();
          if (payloadStr.includes('CBTC')) {
            console.log(`✅✅✅ FOUND CBTC HOLDING!`);
            console.log(`Template ID: ${templateId}`);
            console.log(`Contract ID: ${contract.contractId}`);
            console.log(`Payload:`, JSON.stringify(payload, null, 2));
            return;
          }
        }
        console.log(`Found contracts but no CBTC`);
      } else {
        console.log(`No contracts found`);
      }
    } catch (error) {
      console.log(`Error: ${error.message.substring(0, 100)}`);
    }
    console.log("");
  }
  
  console.log("None of the formats worked. Trying to find from existing contracts...");
  
  // Try to find from existing Order contracts that might reference Holdings
  try {
    const orders = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: ['dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd:Order:Order'],
    }, token);
    
    console.log(`Found ${orders.length} Order contracts, checking for CBTC references...`);
    
    for (const order of orders.slice(0, 5)) {
      const payload = order.payload || order.createArgument || {};
      const payloadStr = JSON.stringify(payload);
      
      // Look for contract IDs or template IDs in payload
      const matches = payloadStr.match(/([a-f0-9]{64}):[^:"]*Holding[^:"]*/gi);
      if (matches) {
        console.log(`Found possible Holding template IDs in Order payload:`, matches);
      }
    }
  } catch (e) {
    console.error(`Error querying orders:`, e.message);
  }
}

main().catch(console.error);
