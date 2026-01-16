/**
 * Get contract IDs from update IDs
 * Uses the update IDs we got from OrderBook creation to find the actual contract IDs
 */

require('dotenv').config();
const CantonAdmin = require('../canton-admin');

const UPDATE_IDS = {
  'BTC/USDT': '12205a4de7760df125603606be947b9a37dbb45d988620c32ebc1a4fc4ebdf1bca6d',
  'ETH/USDT': '1220db3dded16bc387c2ec1de78ad3289b141e15aae3716aef3d37e8cb988f2a7fb1',
  'SOL/USDT': '12201dfb750888de4ec98ee215858996baed210bbb3d41a0c1abb2326b98628c276e',
  'BNB/USDT': '1220df90dd0582ad92ce7a59b88f083eb9139cc6d696bac0728fbc56d901ffc72fe0',
  'ADA/USDT': '1220b90cf17548900ac74e56a9365f6c49d9f2642e543cb67b006e717da566a02e4b',
};

const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://65.108.40.104:31539';
const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
  '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

async function getContractIdFromUpdate(updateId, tradingPair) {
  try {
    const admin = new CantonAdmin();
    const adminToken = await admin.getAdminToken();
    
    // Query updates to find the contract
    // We'll scan recent updates to find the one with this updateId
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        beginExclusive: 0,
        endInclusive: null,
        filter: {
          filtersByParty: {
            [operatorPartyId]: {
              inclusive: {
                templateIds: []
              }
            }
          }
        },
        verbose: true
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to query updates: ${response.status}`);
    }
    
    const data = await response.json();
    const updates = data.updates || [];
    
    // Find the update with matching updateId or transaction that created our OrderBook
    for (const update of updates) {
      if (update.updateId === updateId || 
          (update.transaction && update.transaction.events)) {
        for (const event of update.transaction.events || []) {
          if (event.created && event.created.templateId?.includes('OrderBook')) {
            const createArgs = event.created.createArguments || event.created.argument;
            if (createArgs?.tradingPair === tradingPair) {
              return event.created.contractId;
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting contract ID for ${tradingPair}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 Getting contract IDs from update IDs...\n');
  
  const results = {};
  
  for (const [tradingPair, updateId] of Object.entries(UPDATE_IDS)) {
    console.log(`Getting contract ID for ${tradingPair}...`);
    const contractId = await getContractIdFromUpdate(updateId, tradingPair);
    
    if (contractId) {
      console.log(`  ✅ Found: ${contractId.substring(0, 50)}...`);
      results[tradingPair] = contractId;
    } else {
      console.log(`  ⚠️  Not found (may need to wait for Canton to process)`);
    }
  }
  
  console.log('\n📋 Results:');
  console.log(JSON.stringify(results, null, 2));
  
  if (Object.keys(results).length > 0) {
    console.log('\n✅ Contract IDs found! These can be used to query OrderBooks directly.');
  }
}

main();

