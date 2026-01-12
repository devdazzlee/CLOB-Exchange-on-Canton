/**
 * Create initial OrderBook contracts for testing
 * Usage: node scripts/create-orderbook.js [operator-party-id]
 */

const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';
const API_VERSION = 'v2';

// Default operator party ID (use your wallet's party ID or operator ID)
const DEFAULT_OPERATOR = process.argv[2] || '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

// Trading pairs to create order books for
const TRADING_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

/**
 * Get JWT token from environment or prompt user
 * Can use user's OAuth token with actAs claims (Huzefa's approach) or admin token
 */
function getAuthToken() {
  const token = process.env.CANTON_JWT_TOKEN;
  if (!token) {
    console.error('❌ Error: CANTON_JWT_TOKEN environment variable not set!');
    console.error('');
    console.error('   Option 1: Use user OAuth token (recommended - Huzefa approach):');
    console.error('     - Get token from Keycloak OAuth (user token with actAs/readAs claims)');
    console.error('     - Set: export CANTON_JWT_TOKEN="your_user_token"');
    console.error('');
    console.error('   Option 2: Use admin/operator token:');
    console.error('     - Get token from Keycloak for operator account');
    console.error('     - Set: export CANTON_JWT_TOKEN="your_operator_token"');
    console.error('');
    console.error('   Then run: node scripts/create-orderbook.js');
    process.exit(1);
  }
  return token;
}

/**
 * Create a contract on the ledger using v2 API
 */
async function createContract(templateId, payload, partyId) {
  const token = getAuthToken();
  
  try {
    // commandId is REQUIRED by SubmitAndWaitRequest schema (JSON API Commands docs)
    // IMPORTANT: commandId must be at the TOP LEVEL, not inside each command object
    const commandId = `create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const requestBody = {
      commands: [
        {
          CreateCommand: {
            templateId: templateId,
            createArguments: payload
          }
        }
      ],
      commandId: commandId, // Required by SubmitAndWaitRequest schema - MUST be at top level
      actAs: [partyId]
    };

    const response = await fetch(`${CANTON_API_BASE}/${API_VERSION}/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Failed to create contract: ${response.statusText}` };
      }
      console.error(`   Status: ${response.status}`);
      console.error(`   Error response:`, JSON.stringify(error, null, 2));
      throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to create contract: ${response.statusText}`);
    }

    const result = await response.json();
    // Extract contract ID from v2 response format
    const contractId = result.events?.[0]?.created?.contractId || result.contractId;
    return { contractId, ...result };
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
    // Format payload according to DAML JSON API v2 format
    // For createArguments, Optional fields should be:
    // - Omitted entirely if None, OR
    // - Set to null if None
    // { None: null } format is for exercise arguments, NOT createArguments!
    const payload = {
      tradingPair: pair,
      buyOrders: [],
      sellOrders: [],
      lastPrice: null,  // Optional in createArguments uses null, not { None: null }
      operator: operatorPartyId,
      activeUsers: [],  // Initially empty - will be populated as users place orders (they become observers)
      userAccounts: {}  // Map of party to UserAccount contract ID for balance updates (initially empty)
    };
    
    console.log(`   Payload:`, JSON.stringify(payload, null, 2));
    
    const result = await createContract('OrderBook:OrderBook', payload, operatorPartyId);
    
    // Extract contract ID from v2 response
    let contractId = null;
    if (result.events && result.events.length > 0) {
      const createdEvent = result.events.find(e => e.created);
      if (createdEvent && createdEvent.created) {
        contractId = createdEvent.created.contractId;
      }
    }
    
    if (contractId) {
      console.log(`✅ Created OrderBook for ${pair}`);
      console.log(`   Contract ID: ${contractId}`);
      return contractId;
    } else {
      console.log(`⚠️  OrderBook created but contract ID not found`);
      console.log(`   Full response:`, JSON.stringify(result, null, 2));
      return result;
    }
  } catch (error) {
    console.error(`❌ Failed to create OrderBook for ${pair}:`, error.message);
    if (error.message.includes('Invalid value')) {
      console.error(`   This might be a payload format issue. Check DAML template.`);
    }
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


