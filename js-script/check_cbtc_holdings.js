/**
 * Check what Holdings were found via InterfaceFilter
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('../backend/src/services/cantonService');
const tokenProvider = require('../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";
const INTERFACE_ID = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";

async function main() {
  console.log("Checking Holdings found via InterfaceFilter...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  const contracts = await cantonService.queryActiveContracts({
    party: PARTY_ID,
    templateIds: [INTERFACE_ID],
  }, token);
  
  console.log(`Found ${contracts.length} Holdings\n`);
  
  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    console.log(`=${'='.repeat(68)}`);
    console.log(`Holding ${i + 1}:`);
    console.log(`Contract ID: ${contract.contractId?.substring(0, 40)}...`);
    console.log(`Template ID: ${contract.templateId}`);
    
    const payload = contract.payload || contract.createArgument || {};
    const payloadStr = JSON.stringify(payload);
    
    console.log(`\nPayload:`, JSON.stringify(payload, null, 2));
    
    // Check for CBTC
    if (payloadStr.toUpperCase().includes('CBTC')) {
      console.log(`\n✅✅✅ THIS IS A CBTC HOLDING!`);
      
      // Extract amount
      const amount = payload.amount || payload.quantity || 'unknown';
      console.log(`Amount: ${amount}`);
    } else {
      console.log(`\n(Not CBTC)`);
    }
    console.log('');
  }
}

main().catch(console.error);
