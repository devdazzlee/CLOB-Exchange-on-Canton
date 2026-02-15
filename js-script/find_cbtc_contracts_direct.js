/**
 * Find CBTC contracts by querying all contracts and filtering for CBTC
 * This bypasses the template ID issue by looking at actual contracts
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('../../backend/src/services/cantonService');
const tokenProvider = require('../../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("Finding CBTC contracts by querying known templates...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Get all packages
  const packages = await cantonService.getPackages(token);
  console.log(`Found ${packages.length} packages\n`);
  
  // Try querying with different template patterns
  // Since we know the format is Splice.Api.Token.HoldingV1:Holding, let's test all packages
  console.log("Testing all packages for Splice Holding template...\n");
  
  const patterns = [
    'Splice.Api.Token.HoldingV1:Holding',
    'Splice.Api.Token:Holding',
    'Token.HoldingV1:Holding',
  ];
  
  let foundContracts = [];
  let tested = 0;
  
  for (const pkgId of packages) {
    for (const pattern of patterns) {
      const templateId = `${pkgId}:${pattern}`;
      tested++;
      
      if (tested % 50 === 0) {
        process.stdout.write(`Tested ${tested} templates...\r`);
      }
      
      try {
        const contracts = await cantonService.queryActiveContracts({
          party: PARTY_ID,
          templateIds: [templateId],
        }, token);
        
        if (contracts.length > 0) {
          // Check for CBTC
          for (const contract of contracts) {
            const payload = contract.payload || contract.createArgument || {};
            const payloadStr = JSON.stringify(payload).toUpperCase();
            
            if (payloadStr.includes('CBTC')) {
              foundContracts.push({
                contractId: contract.contractId,
                templateId: templateId,
                payload: payload
              });
            }
          }
        }
      } catch (e) {
        // Template doesn't exist, continue
      }
    }
    
    // If we found contracts, stop searching
    if (foundContracts.length > 0) {
      break;
    }
  }
  
  console.log('\n');
  
  if (foundContracts.length > 0) {
    console.log("=".repeat(70));
    console.log("FOUND CBTC CONTRACTS!");
    console.log("=".repeat(70));
    
    for (const contract of foundContracts) {
      console.log(`\nContract ID: ${contract.contractId}`);
      console.log(`Template ID: ${contract.templateId}`);
      
      const amount = contract.payload.amount || contract.payload.quantity || 'unknown';
      const symbol = contract.payload.instrumentId?.symbol || contract.payload.instrument?.id?.symbol || 'CBTC';
      
      console.log(`Amount: ${amount} ${symbol}`);
      console.log(`Payload:`, JSON.stringify(contract.payload, null, 2));
    }
    
    // Extract package ID from template ID
    const packageId = foundContracts[0].templateId.split(':')[0];
    const holdingTemplateId = `${packageId}:Splice.Api.Token.HoldingV1:Holding`;
    
    console.log("\n" + "=".repeat(70));
    console.log("USE THIS TEMPLATE ID:");
    console.log("=".repeat(70));
    console.log(holdingTemplateId);
    console.log("\n" + "=".repeat(70));
    
  } else {
    console.log("Could not find CBTC contracts");
    console.log("\nPossible reasons:");
    console.log("1. Transfers are 'Offered' and need to be accepted first");
    console.log("2. CBTC might be in a different template format");
    console.log("3. Need to check Utilities UI for contract IDs");
  }
}

main().catch(console.error);
