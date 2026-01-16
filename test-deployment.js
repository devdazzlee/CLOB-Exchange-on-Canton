/**
 * Comprehensive deployment test
 * Tests DAR upload, OrderBook creation, and querying
 */

require('dotenv').config({ path: './backend/.env' });
const CantonAdmin = require('./backend/canton-admin');

const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';
const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
  '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

const knownPackageIds = [
  '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9',
  'ebe9b93c1bd07c02de5635347a8bf1904bf96f7918b65136621bf61c16090e1e',
];

async function testDeployment() {
  console.log('🧪 Testing CLOB Exchange Deployment\n');
  
  const admin = new CantonAdmin();
  const adminToken = await admin.getAdminToken();
  console.log('✅ Got admin token\n');
  
  // Test 1: Try to create an OrderBook with unqualified template ID
  console.log('Test 1: Creating OrderBook with unqualified template ID...');
  try {
    const createResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        commandId: `test-create-${Date.now()}`,
        commands: [{
          CreateCommand: {
            templateId: 'OrderBook:OrderBook',
            createArguments: {
              tradingPair: 'TEST/USDT',
              buyOrders: [],
              sellOrders: [],
              lastPrice: null,
              operator: operatorPartyId
            }
          }
        }],
        actAs: [operatorPartyId]
      })
    });
    
    const responseText = await createResponse.text();
    let createResult;
    try {
      createResult = JSON.parse(responseText);
    } catch {
      console.log('Response (not JSON):', responseText.substring(0, 500));
      createResult = { error: responseText };
    }
    
    if (createResponse.ok && !createResult.error) {
      console.log('✅ OrderBook creation succeeded!');
      console.log('Update ID:', createResult.updateId);
      console.log('Completion Offset:', createResult.completionOffset);
      
      // Try to get contract ID
      if (createResult.completionOffset !== undefined) {
        console.log('\nTest 2: Querying for created OrderBook...');
        
        // Query transaction events
        const updatesResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/updates`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            beginExclusive: createResult.completionOffset,
            endInclusive: createResult.completionOffset,
            filter: {
              filtersByParty: {
                [operatorPartyId]: {
                  inclusive: { templateIds: [] }
                }
              }
            },
            verbose: true
          })
        });
        
        if (updatesResponse.ok) {
          const updatesData = await updatesResponse.json();
          const updates = updatesData.updates || [];
          
          for (const update of updates) {
            if (update.transaction?.events) {
              for (const event of update.transaction.events) {
                if (event.created?.templateId?.includes('OrderBook')) {
                  console.log('✅ Found OrderBook contract!');
                  console.log('Contract ID:', event.created.contractId);
                  console.log('Template ID:', event.created.templateId);
                  console.log('Trading Pair:', event.created.createArguments?.tradingPair);
                  
                  // Test querying this contract
                  console.log('\nTest 3: Querying the created OrderBook...');
                  const queryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${adminToken}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      activeAtOffset: "0",
                      filter: {
                        filtersForAnyParty: {
                          inclusive: {
                            contractIds: [event.created.contractId]
                          }
                        }
                      }
                    })
                  });
                  
                  if (queryResponse.ok) {
                    const queryData = await queryResponse.json();
                    console.log('✅ Successfully queried OrderBook contract!');
                    console.log('Contract data:', JSON.stringify(queryData, null, 2).substring(0, 500));
                  } else {
                    const errorText = await queryResponse.text();
                    console.log('❌ Query failed:', queryResponse.status, errorText.substring(0, 200));
                  }
                  
                  return; // Found it, exit
                }
              }
            }
          }
        }
      }
    } else {
      console.log('❌ OrderBook creation failed');
      console.log('Status:', createResponse.status);
      console.log('Error:', JSON.stringify(createResult, null, 2));
      
      // Try with package ID
      console.log('\nTrying with package ID...');
      for (const pkgId of knownPackageIds) {
        console.log(`Trying package: ${pkgId.substring(0, 16)}...`);
        const createResponse2 = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            commandId: `test-create-${Date.now()}`,
            commands: [{
              CreateCommand: {
                templateId: `${pkgId}:OrderBook:OrderBook`,
                createArguments: {
                  tradingPair: 'TEST/USDT',
                  buyOrders: [],
                  sellOrders: [],
                  lastPrice: null,
                  operator: operatorPartyId
                }
              }
            }],
            actAs: [operatorPartyId]
          })
        });
        
        const responseText2 = await createResponse2.text();
      let result2;
      try {
        result2 = JSON.parse(responseText2);
      } catch {
        result2 = { error: responseText2 };
      }
      
      if (createResponse2.ok && !result2.error) {
          console.log(`✅ Success with package ${pkgId.substring(0, 16)}...!`);
          console.log('Update ID:', result2.updateId);
          return;
        } else {
          console.log(`❌ Failed with package ${pkgId.substring(0, 16)}...:`, result2.code || result2.cause);
        }
      }
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDeployment();

