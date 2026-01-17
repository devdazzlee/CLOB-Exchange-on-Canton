#!/usr/bin/env node
/**
 * CLOB Exchange - Global Order Book Deployment Script
 * 
 * This script initializes the OrderBook contracts for all trading pairs.
 * It uses the backend's existing /api/admin/orderbooks endpoint.
 * 
 * PREREQUISITE: The backend server must be running!
 *   cd backend && yarn dev
 * 
 * Usage:
 *   node scripts/deploymentScript.js
 * 
 * What this script does:
 * 1. Calls the backend API to create OrderBooks for each trading pair
 * 2. The backend handles all Canton interactions using the operator token
 * 3. Result: Global OrderBooks that all users can see and trade against
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

// Backend URL (must be running!)
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Trading pairs to initialize (using / format for the API)
const TRADING_PAIRS = [
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT'
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if the backend is running
 */
async function checkBackendHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      timeout: 5000
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Get existing OrderBooks from the backend
 */
async function getExistingOrderBooks() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/orderbooks`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.orderBooks || [];
    }
    return [];
  } catch (error) {
    console.error('[Deployment] Error fetching existing OrderBooks:', error.message);
    return [];
  }
}

/**
 * Create an OrderBook for a trading pair
 */
async function createOrderBook(tradingPair) {
  console.log(`[Deployment] Creating OrderBook for ${tradingPair}...`);
  
  try {
    const encodedPair = encodeURIComponent(tradingPair);
    const response = await fetch(`${BACKEND_URL}/api/admin/orderbooks/${encodedPair}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`[Deployment] ✅ OrderBook for ${tradingPair} created successfully!`);
      return { success: true, tradingPair, data };
    } else if (response.status === 409) {
      console.log(`[Deployment] ℹ️  OrderBook for ${tradingPair} already exists`);
      return { success: true, tradingPair, alreadyExists: true, data };
    } else {
      console.error(`[Deployment] ❌ Failed to create OrderBook for ${tradingPair}:`, data.error || data.message);
      return { success: false, tradingPair, error: data.error || data.message };
    }
  } catch (error) {
    console.error(`[Deployment] ❌ Error creating OrderBook for ${tradingPair}:`, error.message);
    return { success: false, tradingPair, error: error.message };
  }
}

// =============================================================================
// MAIN DEPLOYMENT
// =============================================================================

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       CLOB Exchange - Global Order Book Deployment             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('[Deployment] Configuration:');
  console.log(`[Deployment]   Backend URL: ${BACKEND_URL}`);
  console.log(`[Deployment]   Trading Pairs: ${TRADING_PAIRS.join(', ')}`);
  console.log('');
  
  // Step 1: Check if backend is running
  console.log('[Deployment] Step 1: Checking backend health...');
  const backendHealthy = await checkBackendHealth();
  
  if (!backendHealthy) {
    console.error('[Deployment] ❌ Backend is not running!');
    console.error('[Deployment] Please start the backend first:');
    console.error('[Deployment]   cd backend && yarn dev');
    console.error('');
    process.exit(1);
  }
  
  console.log('[Deployment] ✅ Backend is running');
  console.log('');
  
  // Step 2: Check existing OrderBooks
  console.log('[Deployment] Step 2: Checking existing OrderBooks...');
  const existingOrderBooks = await getExistingOrderBooks();
  const existingPairs = existingOrderBooks.map(ob => ob.tradingPair);
  
  console.log(`[Deployment] Found ${existingOrderBooks.length} existing OrderBooks:`);
  existingPairs.forEach(pair => console.log(`[Deployment]   - ${pair}`));
  console.log('');
  
  // Step 3: Create OrderBooks for each trading pair
  console.log('[Deployment] Step 3: Creating OrderBooks...');
  console.log('');
  
  const results = {
    created: [],
    existing: [],
    failed: []
  };
  
  for (const tradingPair of TRADING_PAIRS) {
    console.log(`[Deployment] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const result = await createOrderBook(tradingPair);
    
    if (result.success) {
      if (result.alreadyExists) {
        results.existing.push(tradingPair);
      } else {
        results.created.push(tradingPair);
      }
    } else {
      results.failed.push({ pair: tradingPair, error: result.error });
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Step 4: Summary
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    DEPLOYMENT SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  if (results.created.length > 0) {
    console.log('[Deployment] ✅ Created:');
    results.created.forEach(pair => console.log(`[Deployment]    - ${pair}`));
  }
  
  if (results.existing.length > 0) {
    console.log('[Deployment] ℹ️  Already existed:');
    results.existing.forEach(pair => console.log(`[Deployment]    - ${pair}`));
  }
  
  if (results.failed.length > 0) {
    console.log('[Deployment] ❌ Failed:');
    results.failed.forEach(({ pair, error }) => console.log(`[Deployment]    - ${pair}: ${error}`));
  }
  
  console.log('');
  
  // Final verification
  console.log('[Deployment] Step 4: Verifying deployment...');
  const finalOrderBooks = await getExistingOrderBooks();
  console.log(`[Deployment] Total OrderBooks on ledger: ${finalOrderBooks.length}`);
  finalOrderBooks.forEach(ob => {
    console.log(`[Deployment]   - ${ob.tradingPair}: ${ob.buyOrdersCount || 0} buys, ${ob.sellOrdersCount || 0} sells`);
  });
  
  console.log('');
  
  if (results.failed.length === 0) {
    console.log('[Deployment] 🎉 Deployment complete!');
    console.log('[Deployment] The Global Order Books are now ready for trading.');
    console.log('');
    console.log('[Deployment] Next steps:');
    console.log('[Deployment] 1. Open the frontend: http://localhost:3000');
    console.log('[Deployment] 2. Log in as a user');
    console.log('[Deployment] 3. You should see "Connected to Global Market" badge');
    console.log('[Deployment] 4. Start trading!');
  } else {
    console.log('[Deployment] ⚠️  Deployment completed with errors.');
    console.log('[Deployment] Some OrderBooks may not have been created.');
  }
  
  console.log('');
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run the deployment
main().catch(error => {
  console.error('[Deployment] ❌ FATAL ERROR:', error.message);
  process.exit(1);
});
