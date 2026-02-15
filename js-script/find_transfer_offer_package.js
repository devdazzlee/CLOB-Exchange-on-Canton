/**
 * Find TransferOffer contracts to see what package they use
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('../../backend/src/services/cantonService');
const tokenProvider = require('../../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("Finding TransferOffer contracts to identify package...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Get all packages
  const packages = await cantonService.getPackages(token);
  console.log(`Found ${packages.length} packages\n`);
  
  // Try TransferOffer pattern with # prefix
  const transferOfferTemplate = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:TransferOffer";
  console.log(`Testing: ${transferOfferTemplate}\n`);
  
  try {
    const contracts = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: [transferOfferTemplate],
    }, token);
    
    console.log(`Found ${contracts.length} TransferOffer contracts\n`);
    
    if (contracts.length > 0) {
      for (const contract of contracts) {
        console.log("=".repeat(70));
        console.log(`Contract ID: ${contract.contractId}`);
        console.log(`Template ID: ${contract.templateId || contract.createdEvent?.templateId}`);
        const payload = contract.payload || contract.createArgument || {};
        console.log(`Payload:`, JSON.stringify(payload, null, 2));
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    // Try without # prefix - test all packages
    console.log("\nTrying to find TransferOffer in all packages...\n");
    const patterns = [
      'Splice.Api.Token.HoldingV1:TransferOffer',
      'TransferOffer:TransferOffer',
    ];
    
    for (const pkgId of packages.slice(0, 20)) {
      for (const pattern of patterns) {
        const templateId = `${pkgId}:${pattern}`;
        try {
          const contracts = await cantonService.queryActiveContracts({
            party: PARTY_ID,
            templateIds: [templateId],
          }, token);
          
          if (contracts.length > 0) {
            console.log(`✅ Found TransferOffer with template: ${templateId}`);
            const contract = contracts[0];
            const payload = contract.payload || contract.createArgument || {};
            if (JSON.stringify(payload).toUpperCase().includes('CBTC')) {
              console.log(`✅ This TransferOffer has CBTC!`);
              console.log(`Package ID: ${pkgId}`);
              console.log(`Use this for Holding template: ${pkgId}:Splice.Api.Token.HoldingV1:Holding`);
              return;
            }
          }
        } catch (e) {
          // Continue
        }
      }
    }
  }
}

main().catch(console.error);
