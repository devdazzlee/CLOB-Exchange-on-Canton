/**
 * Create initial OrderBook contracts for testing
 * Usage: node scripts/create-orderbook.js [operator-party-id]
 */

const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';
const API_VERSION = 'v1';

// Default operator party ID (use your wallet's party ID or operator ID)
const DEFAULT_OPERATOR = process.argv[2] || '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

// Trading pairs to create order books for
const TRADING_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

/**
 * Create a contract on the ledger
 */
async function createContract(templateId, payload, partyId) {
  try {
    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId: templateId,
        payload: payload,
        actAs: [partyId]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to create contract: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Error creating ${templateId}:`, error.message);
    throw error;
  }
}

/**
 * Create OrderBook for a trading pair
 */
async function createOrderBook(pair, operatorPartyId) {
  console.log(`Creating OrderBook for ${pair}...`);
  
  try {
    const result = await createContract('OrderBook:OrderBook', {
      tradingPair: pair,
      buyOrders: [],
      sellOrders: [],
      lastPrice: null,
      operator: operatorPartyId
    }, operatorPartyId);
    
    console.log(`✅ Created OrderBook for ${pair}`);
    console.log(`   Contract ID: ${result.contractId}`);
    return result.contractId;
  } catch (error) {
    console.error(`❌ Failed to create OrderBook for ${pair}:`, error.message);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🌱 Creating OrderBook contracts...\n');
  console.log(`Operator Party ID: ${DEFAULT_OPERATOR}\n`);
  console.log(`Canton API: ${CANTON_API_BASE}\n`);
  
  const results = [];
  
  for (const pair of TRADING_PAIRS) {
    const contractId = await createOrderBook(pair, DEFAULT_OPERATOR);
    if (contractId) {
      results.push({ pair, contractId });
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n✅ OrderBook creation complete!\n');
  console.log('Summary:');
  results.forEach(({ pair, contractId }) => {
    console.log(`  ${pair}: ${contractId}`);
  });
  
  if (results.length > 0) {
    console.log('\n🎉 OrderBooks are ready! You can now place orders in the frontend.');
  } else {
    console.log('\n⚠️  No OrderBooks were created. Check errors above.');
  }
}

// Run
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
}

module.exports = { createOrderBook };

