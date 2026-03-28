const path = require('path');
require('dotenv').config();

const cantonService = require('./src/services/cantonService');
const tokenProvider = require('./src/services/tokenProvider');
const config = require('./src/config');

async function main() {
  try {
    console.log("Fetching Canton Access Token...");
    const token = await tokenProvider.getServiceToken();
    console.log("Token received.");
    
    console.log("\nQuerying Active Contracts on Canton JSON API [", config.canton.jsonApiBase, "]...");
    // Operator is a party that can see orders
    const result = await cantonService.queryActiveContracts(token, [config.canton.operatorPartyId]);
    
    const orders = result.filter(c => c.templateId.includes('Order:Order'));
    const allocations = result.filter(c => c.templateId.includes('Allocation'));
    const holdings = result.filter(c => c.templateId.includes('Holding'));
    
    console.log(`\n=== LEDGER TRUTH RESULTS ===`);
    console.log(`Total Active 'Order:Order' Contracts: ${orders.length}`);
    console.log(`Total Active 'Allocation' Contracts (Locked Holdings): ${allocations.length}`);
    console.log(`Total Raw 'Holding' Contracts: ${holdings.length}`);
    
    if(orders.length > 0) {
      console.log(`\nLATEST ON-CHAIN ORDER:`);
      const latestOrder = orders[orders.length - 1];
      console.log(JSON.stringify({
        templateId: latestOrder.templateId,
        contractId: latestOrder.contractId,
        owner: latestOrder.payload.owner,
        quantity: latestOrder.payload.quantity,
        price: latestOrder.payload.price,
        allocationContractId: latestOrder.payload.allocationContractId || latestOrder.payload.lockedHoldingCid,
      }, null, 2));
    }

    if(allocations.length > 0) {
      console.log(`\nLATEST ON-CHAIN ALLOCATION (PROVING FUNDS ARE LOCKED):`);
      const latestAlloc = allocations[allocations.length - 1];
      console.log(JSON.stringify({
        templateId: latestAlloc.templateId,
        contractId: latestAlloc.contractId,
        party: latestAlloc.payload.party || latestAlloc.payload.owner || 'hidden',
        amount: latestAlloc.payload.amount || 'hidden',
      }, null, 2));
    }

  } catch(e) {
    console.error("API Query Error:", e.message);
  }
}

main().then(() => process.exit(0));
