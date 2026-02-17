/**
 * LOOKUP CBTC CONTRACT TO GET TEMPLATE ID
 * 
 * Usage: node lookup_cbtc_contract.js <CONTRACT_ID>
 */

const fetch = require('node-fetch');

const CANTON_API = "http://65.108.40.104:31539";

async function getToken() {
  console.log("Getting auth token...");
  const response = await fetch("https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "Sesnp3u6udkFF983rfprvsBbx3X3mBpw",
      client_secret: "mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYp",
      grant_type: "client_credentials",
      scope: "openid profile email daml_ledger_api"
    })
  });
  const data = await response.json();
  return data.access_token;
}

async function lookupContract(contractId, token) {
  console.log(`Looking up contract: ${contractId}...\n`);
  
  const response = await fetch(`${CANTON_API}/v2/contracts/lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ contractId })
  });
  
  if (!response.ok) {
    throw new Error(`Contract lookup failed: ${response.status} - ${await response.text()}`);
  }
  
  return await response.json();
}

async function main() {
  const contractId = process.argv[2];
  
  console.log("=".repeat(70));
  console.log("LOOKUP CBTC CONTRACT TO GET TEMPLATE ID");
  console.log("=".repeat(70));
  
  if (!contractId) {
    console.log("\n❌ No contract ID provided!\n");
    console.log("STEPS TO GET CONTRACT ID:");
    console.log("1. Visit: https://utilities.dev.canton.wolfedgelabs.com/");
    console.log("2. Go to: Registry -> Transfers");
    console.log("3. Find your CBTC transfer offer (from the faucet)");
    console.log("4. Copy the contract ID");
    console.log("5. Run: node lookup_cbtc_contract.js <CONTRACT_ID>\n");
    console.log("=".repeat(70));
    process.exit(1);
  }
  
  try {
    const token = await getToken();
    const contract = await lookupContract(contractId, token);
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ CONTRACT FOUND');
    console.log('='.repeat(70));
    
    const templateId = contract.templateId;
    const payload = contract.payload || contract.createArgument || {};
    
    console.log('\nTemplate ID:');
    console.log(templateId);
    
    console.log('\nContract Payload:');
    console.log(JSON.stringify(payload, null, 2));
    
    // Check if it's CBTC
    const payloadStr = JSON.stringify(payload).toUpperCase();
    const isCbtc = payloadStr.includes('CBTC');
    const isHolding = templateId.includes('Holding');
    const isTransferOffer = templateId.includes('TransferOffer');
    
    console.log('\n' + '='.repeat(70));
    console.log('ANALYSIS:');
    console.log('='.repeat(70));
    console.log(`Is CBTC: ${isCbtc ? '✅ YES' : '❌ NO'}`);
    console.log(`Is Holding: ${isHolding ? '✅ YES' : '❌ NO'}`);
    console.log(`Is TransferOffer: ${isTransferOffer ? '✅ YES' : '❌ NO'}`);
    
    if (isCbtc && isHolding) {
      console.log('\n' + '='.repeat(70));
      console.log('✅✅✅ THIS IS A CBTC HOLDING CONTRACT!');
      console.log('='.repeat(70));
      console.log('\nUse this template ID in your code:');
      console.log(`const SPLICE_TEMPLATE_ID = "${templateId}";`);
    } else if (isTransferOffer) {
      console.log('\n' + '='.repeat(70));
      console.log('📝 THIS IS A TRANSFER OFFER');
      console.log('='.repeat(70));
      console.log('\nYou need to:');
      console.log('1. Accept this transfer offer in the Utilities UI');
      console.log('2. After accepting, you\'ll get a Holding contract');
      console.log('3. Use the Holding contract ID to get the template ID');
      console.log('\nOR:');
      console.log('Extract the Holding template ID from this TransferOffer payload');
      console.log('(Look for fields like: holding.templateId or instrument.templateId)');
    } else {
      console.log('\n❌ This contract is not a CBTC Holding or TransferOffer');
      console.log('Try a different contract ID from the Utilities UI');
    }
    
    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.log('\n❌ ERROR:', error.message);
  }
}

main();
