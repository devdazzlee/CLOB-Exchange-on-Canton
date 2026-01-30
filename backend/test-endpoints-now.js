#!/usr/bin/env node
/**
 * Quick API Test Script
 * Run with: node test-endpoints-now.js
 */

const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3001;
const PARTY_ID = `external-wallet-user-test-${Date.now()}::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`;

function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': PARTY_ID
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function test(name, fn) {
  try {
    const result = await fn();
    const success = result.status >= 200 && result.status < 400;
    console.log(`${success ? '✅' : '❌'} ${name} [HTTP ${result.status}]`);
    return result;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           CLOB Exchange API Quick Test                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  console.log(`Test Party: ${PARTY_ID.substring(0, 50)}...\n`);

  // 1. Health
  console.log('=== HEALTH ===');
  await test('Health check', () => request('GET', '/health'));
  
  // 2. Order Books (Public)
  console.log('\n=== ORDER BOOKS (Public) ===');
  await test('Get all order books', () => request('GET', '/api/orderbooks'));
  await test('Get BTC/USDT order book', () => request('GET', '/api/orderbooks/BTC%2FUSDT'));
  
  // 3. Balance
  console.log('\n=== BALANCE ===');
  const balanceResult = await test('Get user balance', () => request('GET', `/api/balance/${encodeURIComponent(PARTY_ID)}`));
  if (balanceResult?.body?.data?.balance) {
    console.log(`   Balance: USDT=${balanceResult.body.data.balance.USDT}, BTC=${balanceResult.body.data.balance.BTC}`);
  }
  
  // 4. Place Order
  console.log('\n=== PLACE ORDERS ===');
  const orderResult = await test('Place LIMIT BUY order', () => request('POST', '/api/orders/place', {
    tradingPair: 'BTC/USDT',
    orderType: 'BUY',
    orderMode: 'LIMIT',
    price: '50000',
    quantity: '0.01',
    partyId: PARTY_ID
  }));
  
  if (orderResult?.body?.data) {
    console.log(`   Order ID: ${orderResult.body.data.orderId}`);
    console.log(`   Contract ID: ${orderResult.body.data.contractId?.substring(0, 40)}...`);
  }
  
  await test('Place LIMIT SELL order', () => request('POST', '/api/orders/place', {
    tradingPair: 'BTC/USDT',
    orderType: 'SELL',
    orderMode: 'LIMIT',
    price: '51000',
    quantity: '0.01',
    partyId: PARTY_ID
  }));
  
  await test('Place MARKET order', () => request('POST', '/api/orders/place', {
    tradingPair: 'BTC/USDT',
    orderType: 'BUY',
    orderMode: 'MARKET',
    quantity: '0.001',
    partyId: PARTY_ID
  }));
  
  // 5. Get User Orders
  console.log('\n=== USER ORDERS ===');
  const ordersResult = await test('Get user orders', () => request('GET', `/api/orders/user/${encodeURIComponent(PARTY_ID)}`));
  if (ordersResult?.body?.data?.orders) {
    console.log(`   Found ${ordersResult.body.data.orders.length} orders`);
  }
  
  // 6. Trades
  console.log('\n=== TRADES ===');
  await test('Get BTC/USDT trades', () => request('GET', '/api/trades/BTC%2FUSDT'));
  await test('Get user trades', () => request('GET', `/api/trades/user/${encodeURIComponent(PARTY_ID)}`));
  
  // 7. v1 API
  console.log('\n=== v1 API (Public) ===');
  await test('v1 Get orderbook', () => request('GET', '/api/v1/orderbook/BTC%2FUSDT'));
  await test('v1 Get trades', () => request('GET', '/api/v1/trades'));
  await test('v1 Get tickers', () => request('GET', '/api/v1/tickers'));
  
  // 8. WebSocket Status
  console.log('\n=== WEBSOCKET ===');
  await test('WebSocket status', () => request('GET', '/api/ws/status'));
  
  console.log('\n' + '='.repeat(60));
  console.log('Test complete!\n');
  
  console.log('=== FRONTEND TESTING GUIDE ===\n');
  console.log('1. Open http://localhost:5173 in your browser');
  console.log('2. Create/Import a wallet (top right corner)');
  console.log('3. The trading interface shows:');
  console.log('   📊 Order Book - Real-time bid/ask display');
  console.log('   📝 Order Form - Place limit/market orders');
  console.log('   💰 Balance - Your available funds');
  console.log('   📈 Recent Trades - Latest executions');
  console.log('   📉 Depth Chart - Visual order book');
  console.log('');
  console.log('4. To place an order:');
  console.log('   - Select BUY or SELL');
  console.log('   - Enter price (for LIMIT orders)');
  console.log('   - Enter quantity');
  console.log('   - Click "BUY BTC" or "SELL BTC"');
  console.log('');
  console.log('5. WebSocket Updates:');
  console.log('   - Order book updates in real-time');
  console.log('   - Trades appear instantly');
  console.log('   - Connect to ws://localhost:3001/ws');
}

runTests().catch(console.error);
