/**
 * Initialize OrderBooks for the exchange
 * Uses the backend API endpoint to create OrderBooks
 * 
 * Usage: node backend/scripts/initialize-orderbooks.js
 * Or: npm run init-orderbooks (from backend directory)
 */

require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Common trading pairs to initialize
const TRADING_PAIRS = [
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT',
  'BNB/USDT',
  'ADA/USDT'
];

/**
 * Create OrderBook for a trading pair via backend API
 */
async function createOrderBook(tradingPair) {
  try {
    console.log(`Creating OrderBook for ${tradingPair}...`);
    
    const url = `${BACKEND_URL}/api/admin/orderbooks/${encodeURIComponent(tradingPair)}`;
    console.log(`   Calling: POST ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      let errorData;
      let errorText = '';
      try {
        errorText = await response.text();
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
      } catch (e) {
        errorData = { error: `Failed to read error response: ${e.message}` };
      }
      
      if (response.status === 409) {
        console.log(`   ⚠️  OrderBook already exists for ${tradingPair}`);
        if (errorData.contractId) {
          console.log(`   Contract ID: ${errorData.contractId.substring(0, 30)}...`);
        }
        return { success: true, alreadyExists: true, tradingPair };
      }
      
      // Show more detailed error for debugging
      console.error(`   ❌ HTTP ${response.status} Error:`);
      console.error(`   Response: ${errorText.substring(0, 200)}`);
      
      throw new Error(`Failed to create OrderBook: ${response.status} - ${errorData.error || errorData.message || errorText || 'Unknown error'}`);
    }

    const result = await response.json();
    
    if (result.success && result.contractId) {
      console.log(`   ✅ Created OrderBook for ${tradingPair}`);
      console.log(`   Contract ID: ${result.contractId.substring(0, 30)}...`);
      return { success: true, tradingPair, contractId: result.contractId };
    } else {
      console.log(`   ⚠️  OrderBook creation may have succeeded but contract ID not immediately available`);
      console.log(`   Update ID: ${result.updateId || 'N/A'}`);
      return { success: true, tradingPair, updateId: result.updateId };
    }
  } catch (error) {
    console.error(`   ❌ Error creating OrderBook for ${tradingPair}:`, error.message);
    return { success: false, tradingPair, error: error.message };
  }
}

/**
 * Main initialization function
 */
async function initializeOrderBooks() {
  console.log('🚀 Initializing OrderBooks for CLOB Exchange\n');
  console.log(`Backend URL: ${BACKEND_URL}\n`);
  
  // Check if backend is running
  try {
    const healthCheck = await fetch(`${BACKEND_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error('Backend health check failed');
    }
    console.log('✅ Backend is running\n');
  } catch (error) {
    console.error('❌ Error: Backend server is not running!');
    console.error(`   Please start the backend first: cd backend && npm start`);
    console.error(`   Expected backend URL: ${BACKEND_URL}\n`);
    process.exit(1);
  }

  const results = [];
  
  for (const pair of TRADING_PAIRS) {
    const result = await createOrderBook(pair);
    results.push(result);
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n📊 Summary:\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const alreadyExists = results.filter(r => r.alreadyExists);
  
  console.log(`✅ Successfully created: ${successful.length - alreadyExists.length}`);
  console.log(`⚠️  Already existed: ${alreadyExists.length}`);
  console.log(`❌ Failed: ${failed.length}\n`);

  if (successful.length > 0) {
    console.log('✅ OrderBook initialization complete!\n');
    console.log('Next steps:');
    console.log('1. Verify OrderBooks: npm run check-orderbooks');
    console.log('2. Start the frontend: cd frontend && npm run dev');
    console.log('3. Visit http://localhost:5173 to start trading\n');
  } else if (alreadyExists.length > 0) {
    console.log('✅ All OrderBooks already exist!\n');
  } else {
    console.log('❌ No OrderBooks were created. Check errors above.\n');
    process.exit(1);
  }

  // Show detailed results
  if (successful.length > 0) {
    console.log('Created OrderBooks:');
    successful.forEach(r => {
      if (!r.alreadyExists) {
        console.log(`  ${r.tradingPair}: ${r.contractId ? r.contractId.substring(0, 30) + '...' : 'Created (ID pending)'}`);
      }
    });
    console.log('');
  }
}

// Run initialization
if (require.main === module) {
  initializeOrderBooks().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { initializeOrderBooks, createOrderBook };

