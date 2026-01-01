/**
 * Seed demo data for CLOB Exchange testing
 * 
 * This script creates:
 * - Demo user accounts with balances
 * - Demo orders (buy and sell)
 * - Order books for trading pairs
 * 
 * Usage: node scripts/seed-demo-data.js
 */

const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';
const API_VERSION = 'v1';

// Demo users with their balances
const DEMO_USERS = [
  {
    name: 'Alice',
    partyId: '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292',
    balances: {
      'USDT': 100000.0,
      'BTC': 2.5,
      'ETH': 10.0
    }
  },
  {
    name: 'Bob',
    partyId: 'party::bob', // Replace with actual party ID
    balances: {
      'USDT': 50000.0,
      'BTC': 1.0,
      'ETH': 5.0
    }
  },
  {
    name: 'Charlie',
    partyId: 'party::charlie', // Replace with actual party ID
    balances: {
      'USDT': 75000.0,
      'BTC': 0.5,
      'ETH': 8.0
    }
  }
];

// Demo orders
const DEMO_ORDERS = [
  {
    userId: 'Alice',
    orderId: 'demo_buy_001',
    pair: 'BTC/USDT',
    orderType: 'BUY',
    orderMode: 'LIMIT',
    price: 41900.0,
    quantity: 0.5
  },
  {
    userId: 'Alice',
    orderId: 'demo_buy_002',
    pair: 'BTC/USDT',
    orderType: 'BUY',
    orderMode: 'LIMIT',
    price: 41800.0,
    quantity: 1.0
  },
  {
    userId: 'Bob',
    orderId: 'demo_sell_001',
    pair: 'BTC/USDT',
    orderType: 'SELL',
    orderMode: 'LIMIT',
    price: 42100.0,
    quantity: 0.3
  },
  {
    userId: 'Bob',
    orderId: 'demo_sell_002',
    pair: 'BTC/USDT',
    orderType: 'SELL',
    orderMode: 'LIMIT',
    price: 42200.0,
    quantity: 0.8
  },
  {
    userId: 'Charlie',
    orderId: 'demo_buy_003',
    pair: 'ETH/USDT',
    orderType: 'BUY',
    orderMode: 'LIMIT',
    price: 2490.0,
    quantity: 2.0
  },
  {
    userId: 'Charlie',
    orderId: 'demo_sell_003',
    pair: 'ETH/USDT',
    orderType: 'SELL',
    orderMode: 'LIMIT',
    price: 2510.0,
    quantity: 1.5
  }
];

// Trading pairs for order books
const TRADING_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

/**
 * Convert balances object to DAML Map format
 */
function balancesToMap(balances) {
  const entries = Object.entries(balances).map(([key, value]) => [key, value]);
  return entries;
}

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
 * Create user account
 */
async function createUserAccount(user) {
  console.log(`Creating account for ${user.name}...`);
  
  const balancesMap = balancesToMap(user.balances);
  
  try {
    const result = await createContract('UserAccount:UserAccount', {
      party: user.partyId,
      balances: balancesMap,
      operator: user.partyId // Using same party as operator for demo
    }, user.partyId);
    
    console.log(`✓ Created account for ${user.name}: ${result.contractId}`);
    return result.contractId;
  } catch (error) {
    console.error(`✗ Failed to create account for ${user.name}:`, error.message);
    return null;
  }
}

/**
 * Create order
 */
async function createOrder(order, userPartyId, operatorPartyId) {
  console.log(`Creating ${order.orderType} order ${order.orderId}...`);
  
  const now = new Date().toISOString();
  
  try {
    const result = await createContract('Order:Order', {
      orderId: order.orderId,
      owner: userPartyId,
      orderType: order.orderType,
      orderMode: order.orderMode,
      tradingPair: order.pair,
      price: order.price,
      quantity: order.quantity,
      filled: 0.0,
      status: 'OPEN',
      timestamp: now,
      operator: operatorPartyId
    }, operatorPartyId);
    
    console.log(`✓ Created ${order.orderType} order ${order.orderId}: ${result.contractId}`);
    return result.contractId;
  } catch (error) {
    console.error(`✗ Failed to create order ${order.orderId}:`, error.message);
    return null;
  }
}

/**
 * Create order book
 */
async function createOrderBook(pair, operatorPartyId) {
  console.log(`Creating order book for ${pair}...`);
  
  try {
    const result = await createContract('OrderBook:OrderBook', {
      tradingPair: pair,
      buyOrders: [],
      sellOrders: [],
      lastPrice: null,
      operator: operatorPartyId
    }, operatorPartyId);
    
    console.log(`✓ Created order book for ${pair}: ${result.contractId}`);
    return result.contractId;
  } catch (error) {
    console.error(`✗ Failed to create order book for ${pair}:`, error.message);
    return null;
  }
}

/**
 * Main seeding function
 */
async function seedDemoData() {
  console.log('🌱 Seeding demo data for CLOB Exchange...\n');
  console.log(`Canton API: ${CANTON_API_BASE}\n`);
  
  // Create user accounts
  console.log('=== Creating User Accounts ===');
  const userAccounts = {};
  for (const user of DEMO_USERS) {
    const accountCid = await createUserAccount(user);
    if (accountCid) {
      userAccounts[user.name] = {
        partyId: user.partyId,
        accountCid: accountCid
      };
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n=== Creating Order Books ===');
  const orderBooks = {};
  const operatorPartyId = DEMO_USERS[0].partyId; // Use Alice as operator
  
  for (const pair of TRADING_PAIRS) {
    const obCid = await createOrderBook(pair, operatorPartyId);
    if (obCid) {
      orderBooks[pair] = obCid;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n=== Creating Demo Orders ===');
  for (const order of DEMO_ORDERS) {
    const user = DEMO_USERS.find(u => u.name === order.userId);
    if (user && userAccounts[order.userId]) {
      await createOrder(order, user.partyId, operatorPartyId);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n✅ Demo data seeding complete!');
  console.log('\nSummary:');
  console.log(`- User accounts created: ${Object.keys(userAccounts).length}`);
  console.log(`- Order books created: ${Object.keys(orderBooks).length}`);
  console.log(`- Demo orders created: ${DEMO_ORDERS.length}`);
  console.log('\nYou can now test the frontend with this demo data.');
}

// Run seeding
if (require.main === module) {
  seedDemoData().catch(error => {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  });
}

module.exports = { seedDemoData, createUserAccount, createOrder, createOrderBook };



