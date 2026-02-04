/**
 * Find CBTC by inspecting Order contracts that might reference Holdings
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('./backend/src/services/cantonService');
const tokenProvider = require('./backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("Finding CBTC by inspecting Order contracts...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Query Order contracts
  const orders = await cantonService.queryActiveContracts({
    party: PARTY_ID,
    templateIds: ['dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd:Order:Order'],
  }, token);
  
  console.log(`Found ${orders.length} Order contracts\n`);
  
  // Look for CBTC references or contract IDs
  for (const order of orders.slice(0, 10)) {
    const payload = order.payload || order.createArgument || {};
    const payloadStr = JSON.stringify(payload);
    
    console.log(`Order ${order.contractId.substring(0, 20)}...`);
    console.log(`Trading pair: ${payload.tradingPair || 'unknown'}`);
    
    // Check if trading pair includes CBTC
    if (payloadStr.toUpperCase().includes('CBTC')) {
      console.log(`✅ Found CBTC reference in Order!`);
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
      
      // Look for lockedHoldingCid or other contract IDs
      if (payload.lockedHoldingCid) {
        console.log(`\nFound lockedHoldingCid: ${payload.lockedHoldingCid}`);
        console.log(`This might be a CBTC Holding contract ID!`);
        
        // Try to lookup this contract
        try {
          const holding = await cantonService.lookupContract(payload.lockedHoldingCid, token);
          if (holding) {
            console.log(`\n✅✅✅ FOUND CBTC HOLDING CONTRACT!`);
            console.log(`Template ID: ${holding.templateId}`);
            console.log(`Payload:`, JSON.stringify(holding.payload, null, 2));
            
            // Extract package ID from template ID
            const packageId = holding.templateId.split(':')[0];
            const holdingTemplateId = `${packageId}:Splice.Api.Token.HoldingV1:Holding`;
            console.log(`\nUse this template ID: ${holdingTemplateId}`);
            return holdingTemplateId;
          }
        } catch (e) {
          console.log(`Failed to lookup contract: ${e.message}`);
        }
      }
    }
  }
  
  console.log("\nNo CBTC references found in Orders");
}

main().catch(console.error);
