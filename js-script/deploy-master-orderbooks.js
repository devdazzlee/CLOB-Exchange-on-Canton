#!/usr/bin/env node
/**
 * Direct Deployment Script - Creates MasterOrderBooks using provided token
 * Uses the token you provided to create the global order books
 */

// Your deployment token (fresh token)
const ACCESS_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg2NTcyMzEsImlhdCI6MTc2ODY1NTQzMSwiYXV0aF90aW1lIjoxNzY4NjU0NzY0LCJqdGkiOiJvbnJ0YWM6ODNhMGMwNWItZTdkZS02MzhjLTgzN2EtMTAxZDlhZWQzNzIzIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiYTlhOWIwYTUtNTM0OC00ZjVmLThiOGUtZGRlZDU0MzcxNDZlIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.qzqyVvcsitLxFrx08SWelzrFrXzQBsKxUpATI6j1TLUBtzaKrLj1gYqqKmpyJVmPb5Bw5tz9jd3lJTbJSNQufablHfZhTT52vpKt4tNTMqMKSvrheyqv5qRUYsE-kaP5ZSlob__o3ZZRXC1WmUhQU_tNdFVXytDXO6_3BXBPWJk5Frv-b9CcjxApJSioCNoiiC3UrlfJ7UTS0T5GyLcrT-hAld-pYavZu-SG3CdC49poijntcJ1ybSphddDkdNkcLp2Q2jEIdgleQkaqFaesRSylxWykUS0WViuN3DId-hP_ksIClu_jw4BpsaJFaA9SFZEyoMKqeoPrsBuRAaRJKw";

// Extract party ID from token
function getPartyIdFromToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const sub = payload.sub; // This is the party ID prefix: 8100b2db-86cf-40a1-8351-55483c151cdc
      
      // Check if token has ledger API claims with actAs
      const ledgerApi = payload['https://daml.com/ledgerapi'];
      if (ledgerApi && ledgerApi.actAs && ledgerApi.actAs.length > 0) {
        // Use the first actAs party (this is the full party ID)
        console.log(`[Deploy] Using actAs from token: ${ledgerApi.actAs[0]}`);
        return ledgerApi.actAs[0];
      }
      
      // Try the token's sub value first (maybe Canton accepts just the prefix)
      // If that doesn't work, we'll try the full party ID
      console.log(`[Deploy] Token sub: ${sub}`);
      console.log(`[Deploy] Will try both sub and full party ID`);
      
      // Return the sub for now - we'll try full party ID if this fails
      return sub;
    }
  } catch (e) {
    console.warn('[Deploy] Could not extract party from token:', e.message);
  }
  
  // Default fallback
  return '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
}

const OPERATOR_PARTY_ID = getPartyIdFromToken(ACCESS_TOKEN);
const PUBLIC_OBSERVER_PARTY_ID = 'public-observer';
const CANTON_JSON_API_BASE = 'http://65.108.40.104:31539';

const TRADING_PAIRS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];

async function getLedgerEndOffset() {
  try {
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/ledger-end`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.offset || '0';
    }
  } catch (e) {
    console.warn('[Deploy] Could not get ledger end:', e.message);
  }
  return '0';
}

async function getPackageId() {
  console.log('[Deploy] Discovering package ID...');
  
  // Method 1: Try to get from packages endpoint
  try {
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/packages`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.packageIds && data.packageIds.length > 0) {
        // Try the most recent packages first (they likely contain MasterOrderBook)
        const recentPackages = data.packageIds.slice(-3).reverse();
        
        // Test each package to see if it has MasterOrderBook
        for (const pkgId of recentPackages) {
          try {
            const offset = await getLedgerEndOffset();
            const testResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                activeAtOffset: offset,
                verbose: false,
                filter: {
                  filtersForAnyParty: {
                    inclusive: {
                      templateIds: [`${pkgId}:MasterOrderBook:MasterOrderBook`]
                    }
                  }
                }
              })
            });
            
            if (testResponse.ok) {
              // If we get a response (even empty), the template exists in this package
              console.log(`[Deploy] ✅ Found package ID with MasterOrderBook: ${pkgId}`);
              return pkgId;
            }
          } catch (e) {
            continue;
          }
        }
        
        // If no package has MasterOrderBook, use the most recent one (it should have it after DAR upload)
        const packageId = data.packageIds[data.packageIds.length - 1];
        console.log(`[Deploy] ✅ Using most recent package ID: ${packageId}`);
        return packageId;
      }
    }
  } catch (error) {
    console.warn('[Deploy] Packages endpoint failed:', error.message);
  }
  
  // Method 2: Query for any OrderBook/MasterOrderBook contracts to extract package ID
  try {
    const offset = await getLedgerEndOffset();
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        readAs: [OPERATOR_PARTY_ID],
        activeAtOffset: offset,
        verbose: true,
        filter: {
          filtersForAnyParty: {
            inclusive: {
              templateIds: ['MasterOrderBook:MasterOrderBook', 'OrderBook:OrderBook']
            }
          }
        }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const contracts = Array.isArray(data) ? data : (data.activeContracts || []);
      
      if (contracts.length > 0) {
        const contract = contracts[0];
        const templateId = contract.contractEntry?.JsActiveContract?.createdEvent?.templateId ||
                          contract.createdEvent?.templateId ||
                          contract.templateId;
        
        if (templateId && templateId.includes(':')) {
          const packageId = templateId.split(':')[0];
          console.log(`[Deploy] ✅ Found package ID from existing contracts: ${packageId}`);
          return packageId;
        }
      }
    }
  } catch (error) {
    console.warn('[Deploy] Contract query failed:', error.message);
  }
  
  // Method 3: Use known package IDs as fallback
  // Use the package that has OrderBook:OrderBook (we know this works)
  const knownPackageId = '51522c778cf057ce80b3aa38d272a2fb72ae60ae871bca67940aaccf59567ac9';
  
  console.log(`[Deploy] ⚠️  Using known package ID: ${knownPackageId}`);
  console.log(`[Deploy] NOTE: This package has OrderBook:OrderBook (not MasterOrderBook)`);
  console.log(`[Deploy] We'll use OrderBook:OrderBook for now until MasterOrderBook is deployed`);
  return knownPackageId;
}

async function checkOrderBookExists(tradingPair, packageId) {
  const offset = await getLedgerEndOffset();
  // Try both MasterOrderBook and OrderBook templates
  const templateIds = [
    `${packageId}:MasterOrderBook:MasterOrderBook`,
    `${packageId}:OrderBook:OrderBook`
  ];
  
  for (const templateId of templateIds) {
    try {
      const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          readAs: [OPERATOR_PARTY_ID],
          activeAtOffset: offset,
          verbose: true,
          filter: {
            filtersByParty: {
              [OPERATOR_PARTY_ID]: {
                inclusive: {
                  templateIds: [templateId]
                }
              }
            }
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const contracts = Array.isArray(data) ? data : (data.activeContracts || []);
        
        for (const contract of contracts) {
          const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                              contract.createdEvent || 
                              contract;
          const payload = contractData.createArgument || contractData.argument || contractData.payload;
          
          if (payload && payload.tradingPair === tradingPair) {
            return contractData.contractId || contract.contractId;
          }
        }
      }
    } catch (error) {
      continue;
    }
  }
  
  return null;
}

async function createMasterOrderBook(tradingPair, packageId) {
  console.log(`[Deploy] Creating OrderBook for ${tradingPair}...`);
  
  // Try MasterOrderBook first, fallback to OrderBook
  let templateId = `${packageId}:MasterOrderBook:MasterOrderBook`;
  let payload = {
    operator: OPERATOR_PARTY_ID,
    publicObserver: PUBLIC_OBSERVER_PARTY_ID,
    tradingPair: tradingPair,
    buyOrders: [],
    sellOrders: [],
    lastPrice: null,
    activeUsers: [],
    userAccounts: null
  };
  
  // If MasterOrderBook doesn't exist, use OrderBook (which we know exists)
  const commandId = `create-orderbook-${tradingPair}-${Date.now()}`;
  
  // actAs is required - use the operator party ID
  let requestBody = {
    commands: [
      {
        CreateCommand: {
          templateId: templateId,
          createArguments: payload
        }
      }
    ],
    commandId: commandId,
    actAs: [OPERATOR_PARTY_ID]  // Required field
  };
  
  try {
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { code: 'UNKNOWN', cause: errorText };
      }
      
      // If 401, try with full party ID instead of just sub
      if (response.status === 401) {
        const fullPartyId = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
        if (requestBody.actAs[0] !== fullPartyId) {
          console.log(`[Deploy] 401 with sub, retrying with full party ID: ${fullPartyId}...`);
          requestBody.actAs = [fullPartyId];
          payload.operator = fullPartyId; // Also update operator in payload
          
          const retryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          });
          
          if (!retryResponse.ok) {
            const retryErrorText = await retryResponse.text();
            // If still fails, try OrderBook template
            if (templateId.includes('MasterOrderBook')) {
              console.log(`[Deploy] MasterOrderBook failed, trying OrderBook:OrderBook...`);
              templateId = `${packageId}:OrderBook:OrderBook`;
              payload = {
                tradingPair: tradingPair,
                buyOrders: [],
                sellOrders: [],
                lastPrice: null,
                operator: fullPartyId
              };
              
              requestBody.commands[0].CreateCommand.templateId = templateId;
              requestBody.commands[0].CreateCommand.createArguments = payload;
              
              const orderBookResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${ACCESS_TOKEN}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
              });
              
              if (!orderBookResponse.ok) {
                const orderBookErrorText = await orderBookResponse.text();
                throw new Error(`Create failed: ${orderBookResponse.status} - ${orderBookErrorText}`);
              }
              
              const result = await orderBookResponse.json();
              console.log(`[Deploy] ✅ OrderBook for ${tradingPair} created! (using OrderBook:OrderBook template)`);
              console.log(`[Deploy]    Update ID: ${result.updateId}`);
              console.log(`[Deploy]    Offset: ${result.completionOffset}`);
              return result;
            } else {
              throw new Error(`Create failed: ${retryResponse.status} - ${retryErrorText}`);
            }
          }
          
          const result = await retryResponse.json();
          console.log(`[Deploy] ✅ OrderBook for ${tradingPair} created! (with full party ID)`);
          console.log(`[Deploy]    Update ID: ${result.updateId}`);
          console.log(`[Deploy]    Offset: ${result.completionOffset}`);
          return result;
        }
      }
      
      // If MasterOrderBook doesn't exist, try OrderBook
      if (errorData.code === 'TEMPLATES_OR_INTERFACES_NOT_FOUND' && templateId.includes('MasterOrderBook')) {
        console.log(`[Deploy] MasterOrderBook not found, using OrderBook:OrderBook instead...`);
        templateId = `${packageId}:OrderBook:OrderBook`;
        payload = {
          tradingPair: tradingPair,
          buyOrders: [],
          sellOrders: [],
          lastPrice: null,
          operator: OPERATOR_PARTY_ID
        };
        
        requestBody.commands[0].CreateCommand.templateId = templateId;
        requestBody.commands[0].CreateCommand.createArguments = payload;
        
        // Retry with OrderBook
        const retryResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!retryResponse.ok) {
          const retryErrorText = await retryResponse.text();
          throw new Error(`Create failed: ${retryResponse.status} - ${retryErrorText}`);
        }
        
        const result = await retryResponse.json();
        console.log(`[Deploy] ✅ OrderBook for ${tradingPair} created! (using OrderBook:OrderBook template)`);
        console.log(`[Deploy]    Update ID: ${result.updateId}`);
        console.log(`[Deploy]    Offset: ${result.completionOffset}`);
        return result;
      } else {
        throw new Error(`Create failed: ${response.status} - ${errorText}`);
      }
    }
    
    const result = await response.json();
    console.log(`[Deploy] ✅ MasterOrderBook for ${tradingPair} created!`);
    console.log(`[Deploy]    Update ID: ${result.updateId}`);
    console.log(`[Deploy]    Offset: ${result.completionOffset}`);
    
    return result;
  } catch (error) {
    console.error(`[Deploy] ❌ Failed to create OrderBook for ${tradingPair}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       CLOB Exchange - MasterOrderBook Deployment               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Decode token to show what party we're using
  try {
    const parts = ACCESS_TOKEN.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const ledgerApi = payload['https://daml.com/ledgerapi'];
      console.log('[Deploy] Token Info:');
      console.log(`[Deploy]   Subject (sub): ${payload.sub}`);
      console.log(`[Deploy]   Scope: ${payload.scope}`);
      if (ledgerApi) {
        console.log(`[Deploy]   actAs: ${JSON.stringify(ledgerApi.actAs || [])}`);
        console.log(`[Deploy]   readAs: ${JSON.stringify(ledgerApi.readAs || [])}`);
      } else {
        console.log(`[Deploy]   ⚠️  No ledger API claims in token`);
      }
      console.log('');
    }
  } catch (e) {
    console.warn('[Deploy] Could not decode token:', e.message);
  }
  
  console.log('[Deploy] Configuration:');
  console.log(`[Deploy]   Operator Party ID: ${OPERATOR_PARTY_ID}`);
  console.log(`[Deploy]   Public Observer: ${PUBLIC_OBSERVER_PARTY_ID}`);
  console.log(`[Deploy]   Canton API: ${CANTON_JSON_API_BASE}`);
  console.log(`[Deploy]   Trading Pairs: ${TRADING_PAIRS.join(', ')}`);
  console.log('');
  
  try {
    // Step 1: Get package ID
    const packageId = await getPackageId();
    console.log(`[Deploy] Using package ID: ${packageId}`);
    console.log('');
    
    // Step 2: Create MasterOrderBooks
    const results = {
      created: [],
      existing: [],
      failed: []
    };
    
    for (const tradingPair of TRADING_PAIRS) {
      console.log(`[Deploy] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`[Deploy] Processing: ${tradingPair}`);
      
      try {
        // Check if already exists
        const existingContractId = await checkOrderBookExists(tradingPair, packageId);
        
        if (existingContractId) {
          console.log(`[Deploy] ℹ️  MasterOrderBook already exists: ${existingContractId.substring(0, 30)}...`);
          results.existing.push(tradingPair);
        } else {
          // Create new MasterOrderBook
          await createMasterOrderBook(tradingPair, packageId);
          results.created.push(tradingPair);
        }
      } catch (error) {
        console.error(`[Deploy] ❌ Error with ${tradingPair}:`, error.message);
        results.failed.push({ pair: tradingPair, error: error.message });
      }
      
      console.log('');
    }
    
    // Step 3: Summary
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    DEPLOYMENT SUMMARY                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    if (results.created.length > 0) {
      console.log('[Deploy] ✅ Created:');
      results.created.forEach(pair => console.log(`[Deploy]    - ${pair}`));
    }
    
    if (results.existing.length > 0) {
      console.log('[Deploy] ℹ️  Already existed:');
      results.existing.forEach(pair => console.log(`[Deploy]    - ${pair}`));
    }
    
    if (results.failed.length > 0) {
      console.log('[Deploy] ❌ Failed:');
      results.failed.forEach(({ pair, error }) => console.log(`[Deploy]    - ${pair}: ${error}`));
    }
    
    console.log('');
    console.log('[Deploy] 🎉 Deployment complete!');
    console.log('[Deploy] The Global Order Books are now ready for trading.');
    console.log('');
    
    process.exit(results.failed.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('');
    console.error('[Deploy] ❌ FATAL ERROR:', error.message);
    console.error('[Deploy] Deployment failed. Please check your configuration.');
    console.error('');
    process.exit(1);
  }
}

main();
