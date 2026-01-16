/**
 * Check existing OrderBooks in the ledger
 * Uses the backend API to query OrderBooks
 * 
 * Usage: node backend/scripts/check-orderbooks.js
 * Or: npm run check-orderbooks (from backend directory)
 */

require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Check existing OrderBooks
 */
async function checkOrderBooks() {
  console.log('📋 Checking existing OrderBooks...\n');
  console.log(`Backend URL: ${BACKEND_URL}\n`);

  try {
    // Check if backend is running
    try {
      const healthCheck = await fetch(`${BACKEND_URL}/health`);
      if (!healthCheck.ok) {
        throw new Error('Backend health check failed');
      }
    } catch (error) {
      console.error('❌ Error: Backend server is not running!');
      console.error(`   Please start the backend first: cd backend && npm start`);
      console.error(`   Expected backend URL: ${BACKEND_URL}\n`);
      process.exit(1);
    }

    // Query OrderBooks via backend API
    const response = await fetch(`${BACKEND_URL}/api/orderbooks`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to query OrderBooks: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success && data.orderBooks && data.orderBooks.length > 0) {
      console.log(`✅ Found ${data.orderBooks.length} OrderBook(s):\n`);
      
      data.orderBooks.forEach((orderBook, idx) => {
        console.log(`${idx + 1}. Trading Pair: ${orderBook.tradingPair}`);
        console.log(`   Contract ID: ${orderBook.contractId ? orderBook.contractId.substring(0, 50) + '...' : 'N/A'}`);
        console.log(`   Buy Orders: ${orderBook.buyOrdersCount || 0}`);
        console.log(`   Sell Orders: ${orderBook.sellOrdersCount || 0}`);
        console.log(`   Last Price: ${orderBook.lastPrice || 'N/A'}`);
        console.log(`   Operator: ${orderBook.operator ? orderBook.operator.substring(0, 30) + '...' : 'N/A'}`);
        console.log('');
      });
      
      console.log('✅ OrderBooks are ready for trading!\n');
    } else {
      console.log('⚠️  No OrderBooks found in the ledger\n');
      console.log('To create OrderBooks, run:');
      console.log('  npm run init-orderbooks\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nMake sure:');
    console.error('1. Backend server is running (npm start)');
    console.error('2. Backend can connect to Canton');
    console.error('3. Environment variables are configured\n');
    process.exit(1);
  }
}

// Run check
if (require.main === module) {
  checkOrderBooks();
}

module.exports = { checkOrderBooks };

