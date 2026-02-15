/**
 * Test InterfaceFilter request body
 */

require('dotenv').config({ path: './backend/.env' });
const cantonService = require('../backend/src/services/cantonService');
const tokenProvider = require('../backend/src/services/tokenProvider');

const PARTY_ID = "8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292";
const INTERFACE_ID = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";

async function main() {
  console.log("Testing InterfaceFilter request body...\n");
  
  const token = await tokenProvider.getServiceToken();
  
  // Monkey-patch fetch to log request body
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (options && options.method === 'POST' && url.includes('active-contracts')) {
      console.log("=".repeat(70));
      console.log("REQUEST BODY BEING SENT:");
      console.log("=".repeat(70));
      console.log(JSON.stringify(JSON.parse(options.body), null, 2));
      console.log("=".repeat(70));
    }
    return originalFetch(url, options);
  };
  
  try {
    const contracts = await cantonService.queryActiveContracts({
      party: PARTY_ID,
      templateIds: [INTERFACE_ID],
    }, token);
    
    console.log(`\n✅ Found ${contracts.length} contracts`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
  }
  
  // Restore fetch
  global.fetch = originalFetch;
}

main().catch(console.error);
