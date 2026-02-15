/**
 * Test if # prefix works for template ID
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('../backend/src/services/cantonService');
const tokenProvider = require('../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("Testing # prefix template ID...\n");
  
  const token = await tokenProvider.getServiceToken();
  const templateId = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
  
  console.log(`Template ID: ${templateId}`);
  console.log(`Party ID: ${PARTY_ID.substring(0, 50)}...\n`);
  
  try {
    const contracts = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: [templateId],
    }, token);
    
    console.log(`✅ SUCCESS! Found ${contracts.length} contracts\n`);
    
    if (contracts.length > 0) {
      console.log("Sample contract:");
      const contract = contracts[0];
      console.log(`Contract ID: ${contract.contractId}`);
      const payload = contract.payload || contract.createArgument || {};
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
      
      // Check for CBTC
      const payloadStr = JSON.stringify(payload).toUpperCase();
      if (payloadStr.includes('CBTC')) {
        console.log("\n✅✅✅ FOUND CBTC HOLDING!");
      }
    }
  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
    console.error(error);
  }
}

main().catch(console.error);
