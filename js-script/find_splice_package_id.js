/**
 * Find the actual Splice package ID by querying TransferOffer contracts
 * Since you have transfers available, we can find the package ID from them
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('../../backend/src/services/cantonService');
const tokenProvider = require('../../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("Finding Splice package ID from your transfers...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Get all packages
  const packages = await cantonService.getPackages(token);
  console.log(`Found ${packages.length} packages\n`);
  
  // Try to find TransferOffer contracts
  const transferOfferPatterns = [
    'Splice.Api.Token.HoldingV1:TransferOffer',
    'TransferOffer:TransferOffer',
  ];
  
  console.log("Searching for TransferOffer contracts...\n");
  
  for (const pkgId of packages.slice(0, 50)) { // Check first 50 packages
    for (const pattern of transferOfferPatterns) {
      const templateId = `${pkgId}:${pattern}`;
      
      try {
        const contracts = await cantonService.queryActiveContracts({
          party: PARTY_ID,
          templateIds: [templateId],
        }, token);
        
        if (contracts.length > 0) {
          // Check if any have CBTC
          for (const contract of contracts) {
            const payload = contract.payload || contract.createArgument || {};
            const payloadStr = JSON.stringify(payload).toUpperCase();
            
            if (payloadStr.includes('CBTC')) {
              console.log("=".repeat(70));
              console.log("FOUND CBTC TRANSFER OFFER!");
              console.log("=".repeat(70));
              console.log(`Package ID: ${pkgId}`);
              console.log(`Template ID: ${templateId}`);
              console.log(`Contract ID: ${contract.contractId}`);
              console.log("\nPayload:");
              console.log(JSON.stringify(payload, null, 2));
              
              // Extract Holding template ID
              const holdingTemplateId = `${pkgId}:Splice.Api.Token.HoldingV1:Holding`;
              console.log("\n" + "=".repeat(70));
              console.log("USE THIS TEMPLATE ID FOR HOLDINGS:");
              console.log("=".repeat(70));
              console.log(holdingTemplateId);
              console.log("\n" + "=".repeat(70));
              
              return holdingTemplateId;
            }
          }
        }
      } catch (e) {
        // Template doesn't exist, continue
      }
    }
  }
  
  console.log("Could not find TransferOffer contracts");
  console.log("Try accepting the transfer offer first in Utilities UI");
}

main().catch(console.error);
