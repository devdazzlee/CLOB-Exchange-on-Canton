require('dotenv').config({ path: './.env' });
const scanService = require('./src/services/scanService');
const tokenProvider = require('./src/services/tokenProvider');
const config = require('./src/config');

async function main() {
  try {
    const token = await tokenProvider.getServiceToken();
    
    // We'll use the first party we can find, or the operator
    const partyId = config.canton.operatorPartyId;
    console.log(`Checking Holdings for Operator: ${partyId}`);
    
    const holdings = await scanService.getHoldings(partyId, token);
    console.log(`\nFound ${holdings.length} Holdings on Ledger via Scan Proxy API:`);
    console.log(JSON.stringify(holdings.slice(0, 5), null, 2));

  } catch (err) {
    console.error("Error:", err.message);
  }
}

main().then(() => process.exit(0));
