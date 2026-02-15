/**
 * FIND CBTC TEMPLATE ID VIA BACKEND
 * 
 * Uses the backend's services which have proper token handling
 */

// Set up environment
process.chdir(__dirname);

// Import backend services
const cantonService = require('../../backend/src/services/cantonService');
const tokenProvider = require('../../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";

async function main() {
  console.log("=".repeat(70));
  console.log("FINDING CBTC TEMPLATE ID VIA BACKEND SERVICES");
  console.log("=".repeat(70));
  console.log("\nUsing backend's Canton service with proper token handling...\n");
  
  try {
    // Get service token (same way backend does)
    const token = await tokenProvider.getServiceToken();
    console.log("✅ Got service token\n");
    
    // Get packages
    console.log("Fetching packages...");
    const packagesResponse = await cantonService.getPackages(token);
    let packages = [];
    if (Array.isArray(packagesResponse)) {
      packages = packagesResponse;
    } else if (packagesResponse.packageIds && Array.isArray(packagesResponse.packageIds)) {
      packages = packagesResponse.packageIds;
    }
    
    console.log(`Found ${packages.length} packages\n`);
    
    if (packages.length === 0) {
      console.log("❌ No packages found. Check token permissions.");
      return;
    }
    
    // Test patterns
    const holdingPatterns = [
      'Splice.Api.Token.HoldingV1:Holding',
      'Splice.Api.Token:Holding',
      'Token.HoldingV1:Holding',
      'Token:Holding',
    ];
    
    console.log(`Testing ${packages.length} packages × ${holdingPatterns.length} patterns = ${packages.length * holdingPatterns.length} templates...`);
    console.log("This will take about 30-60 seconds...\n");
    
    let found = false;
    let tested = 0;
    
    for (const pkg of packages) {
      for (const pattern of holdingPatterns) {
        const templateId = `${pkg}:${pattern}`;
        tested++;
        
        if (tested % 20 === 0) {
          process.stdout.write(`Tested ${tested}/${packages.length * holdingPatterns.length}...\r`);
        }
        
        try {
          const contracts = await cantonService.queryActiveContracts({
            party: PARTY_ID,
            templateIds: [templateId],
          }, token);
          
          if (contracts.length > 0) {
            // Check for CBTC
            let totalCbtc = 0;
            let cbtcContracts = 0;
            
            for (const contract of contracts) {
              const payload = contract.payload || contract.createArgument || {};
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
                const p = c.payload || c.createArgument || {};
                return JSON.stringify(p).toUpperCase().includes('CBTC');
              });
              
              if (sampleContract) {
                const payload = sampleContract.payload || sampleContract.createArgument || {};
                console.log('\nSample CBTC Holding contract:');
                console.log(`Contract ID: ${sampleContract.contractId}`);
                console.log(`Payload:`, JSON.stringify(payload, null, 2));
              }
              
              console.log('\n' + '='.repeat(70));
              console.log('NEXT STEPS:');
              console.log('='.repeat(70));
              console.log('\n1. Add this to backend/src/config/constants.js:');
              console.log(`\nSPLICE_CBTC_HOLDING_TEMPLATE_ID: "${templateId}",`);
              console.log('\n2. Update holdingService.js to use this template ID');
              console.log('\n3. Restart backend and test balance endpoint');
              console.log('\n' + '='.repeat(70));
              
              found = true;
              break;
            }
          }
        } catch (e) {
          // Template doesn't exist or query failed, continue
        }
      }
      if (found) break;
    }
    
    if (!found) {
      console.log('\n❌ CBTC Holding template not found');
      console.log('\nTried:');
      console.log(`- ${packages.length} packages`);
      console.log(`- ${holdingPatterns.length} patterns`);
      console.log(`- ${tested} total templates tested`);
      console.log('\nPossible reasons:');
      console.log('1. CBTC Holdings might use a different template pattern');
      console.log('2. You might need to accept the TransferOffer first');
      console.log('3. CBTC might be stored in a different template type');
      console.log('\nTry: node find_transfer_offer.js');
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);
