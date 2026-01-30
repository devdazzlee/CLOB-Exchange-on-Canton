/**
 * CLOB Exchange API Test Script
 * Run with: node test-api.js
 */

const BASE_URL = 'http://localhost:3001';
const PARTY_ID = `external-wallet-user-test-${Date.now()}::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`;

let passed = 0;
let failed = 0;
let createdOrderId = null;
let createdContractId = null;

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}`);
    passed++;
    return result;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
    return null;
  }
}

async function get(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'x-user-id': PARTY_ID }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
  }
  return response.json();
}

async function post(endpoint, data) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': PARTY_ID
    },
    body: JSON.stringify(data)
  });
  if (!response.ok && response.status !== 201) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
  }
  return response.json();
}

async function runTests() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           CLOB Exchange API Test Suite                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🔧 Test Party ID: ${PARTY_ID.substring(0, 40)}...`);
  console.log('');

  // 1. Health Check
  console.log('═══ 1. HEALTH & STATUS ═══');
  await test('Health check', () => get('/health'));
  console.log('');

  // 2. Order Book (Global - Public)
  console.log('═══ 2. ORDER BOOK (Global) ═══');
  await test('Get all order books', () => get('/api/orderbooks'));
  await test('Get BTC/USDT order book', () => get('/api/orderbooks/BTC%2FUSDT'));
  await test('Get aggregated order book', () => get('/api/orderbooks/BTC%2FUSDT?aggregate=true'));
  console.log('');

  // 3. Balance
  console.log('═══ 3. BALANCE ═══');
  await test('Get user balance', async () => {
    const result = await get(`/api/balance/${PARTY_ID}`);
    console.log(`   Balance: USDT=${result.data?.balance?.USDT || '10000.0'}, BTC=${result.data?.balance?.BTC || '0.0'}`);
    return result;
  });
  console.log('');

  // 4. Place Orders
  console.log('═══ 4. PLACE ORDERS ═══');
  
  // Place LIMIT BUY order
  const buyOrder = await test('Place LIMIT BUY order', async () => {
    const result = await post('/api/orders/place', {
      tradingPair: 'BTC/USDT',
      orderType: 'BUY',
      orderMode: 'LIMIT',
      price: '50000',
      quantity: '0.01',
      partyId: PARTY_ID
    });
    if (result.data) {
      createdOrderId = result.data.orderId;
      createdContractId = result.data.contractId;
      console.log(`   Order ID: ${createdOrderId}`);
      console.log(`   Contract ID: ${createdContractId?.substring(0, 40)}...`);
    }
    return result;
  });

  // Place LIMIT SELL order
  await test('Place LIMIT SELL order', () => post('/api/orders/place', {
    tradingPair: 'BTC/USDT',
    orderType: 'SELL',
    orderMode: 'LIMIT',
    price: '51000',
    quantity: '0.01',
    partyId: PARTY_ID
  }));

  // Place MARKET order
  await test('Place MARKET BUY order', () => post('/api/orders/place', {
    tradingPair: 'BTC/USDT',
    orderType: 'BUY',
    orderMode: 'MARKET',
    quantity: '0.001',
    partyId: PARTY_ID
  }));
  console.log('');

  // 5. User Orders
  console.log('═══ 5. USER ORDERS ═══');
  await test('Get user orders', async () => {
    const result = await get(`/api/orders/user/${PARTY_ID}`);
    console.log(`   Found ${result.data?.orders?.length || 0} orders`);
    return result;
  });
  console.log('');

  // 6. Cancel Order
  console.log('═══ 6. CANCEL ORDER ═══');
  if (createdContractId) {
    await test('Cancel order', () => post('/api/orders/cancel', {
      orderContractId: createdContractId,
      partyId: PARTY_ID,
      tradingPair: 'BTC/USDT'
    }));
  } else {
    console.log('⚠️  Skipped: No order to cancel');
  }
  console.log('');

  // 7. Trades
  console.log('═══ 7. TRADES ═══');
  await test('Get BTC/USDT trades', () => get('/api/trades/BTC%2FUSDT'));
  await test('Get user trades', () => get(`/api/trades/user/${PARTY_ID}?limit=50`));
  console.log('');

  // 8. v1 API
  console.log('═══ 8. v1 API (Public) ═══');
  await test('v1 Get orderbook', () => get('/api/v1/orderbook/BTC%2FUSDT'));
  await test('v1 Get trades', () => get('/api/v1/trades'));
  await test('v1 Get tickers', () => get('/api/v1/tickers'));
  console.log('');

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                      TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED!');
  } else {
    console.log('⚠️  Some tests failed. Check the output above.');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                 FRONTEND TESTING');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('To test in browser:');
  console.log('1. Open http://localhost:5173');
  console.log('2. The trading interface should load with:');
  console.log('   - Order Book (showing bids/asks)');
  console.log('   - Order Form (place limit/market orders)');
  console.log('   - Balance display (USDT/BTC)');
  console.log('   - Recent Trades');
  console.log('3. Try placing a limit order:');
  console.log('   - Select BUY, enter price 50000, quantity 0.01');
  console.log('   - Click "BUY BTC"');
  console.log('4. Watch the order appear in the order book');
  console.log('');
}

runTests().catch(console.error);
