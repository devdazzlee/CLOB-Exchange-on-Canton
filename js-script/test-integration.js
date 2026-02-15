/**
 * Integration Test Script
 * Tests all 4 milestones are properly integrated
 */

const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

async function testEndpoint(method, path, body = null, headers = {}) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json().catch(() => ({}));
    
    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

async function runTests() {
  console.log('🧪 Testing CLOB Exchange Integration\n');
  
  // Test 1: Health check
  console.log('1. Testing health endpoint...');
  const health = await testEndpoint('GET', '/health');
  console.log(health.ok ? '✅ Health check passed' : '❌ Health check failed');
  console.log('');
  
  // Test 2: Order book endpoint (Milestone 3 - aggregation)
  console.log('2. Testing order book endpoint with aggregation...');
  const orderBook = await testEndpoint('GET', '/orderbooks/BTC%2FUSDT?aggregate=true&precision=2&depth=50');
  if (orderBook.ok) {
    console.log('✅ Order book endpoint works');
    console.log('   - Has aggregated data:', !!orderBook.data?.data?.orderBook?.bids);
    console.log('   - Has spread calculation:', !!orderBook.data?.data?.orderBook?.spread);
  } else {
    console.log('❌ Order book endpoint failed:', orderBook.error || orderBook.status);
  }
  console.log('');
  
  // Test 3: Activity markers (Milestone 4)
  console.log('3. Testing activity markers...');
  const activityMarker = orderBook.headers['x-activity-marker'];
  if (activityMarker) {
    console.log('✅ Activity markers present');
    console.log('   - Marker:', activityMarker.substring(0, 50) + '...');
  } else {
    console.log('⚠️  Activity markers not found in headers');
  }
  console.log('');
  
  // Test 4: Security headers (Milestone 4)
  console.log('4. Testing security headers...');
  const securityHeaders = {
    'x-frame-options': orderBook.headers['x-frame-options'],
    'x-content-type-options': orderBook.headers['x-content-type-options'],
    'x-xss-protection': orderBook.headers['x-xss-protection']
  };
  const hasSecurityHeaders = Object.values(securityHeaders).some(v => v);
  console.log(hasSecurityHeaders ? '✅ Security headers present' : '⚠️  Security headers missing');
  console.log('');
  
  console.log('📊 Test Summary:');
  console.log(`   Health: ${health.ok ? '✅' : '❌'}`);
  console.log(`   Order Book: ${orderBook.ok ? '✅' : '❌'}`);
  console.log(`   Activity Markers: ${activityMarker ? '✅' : '⚠️'}`);
  console.log(`   Security Headers: ${hasSecurityHeaders ? '✅' : '⚠️'}`);
  console.log('');
  
  if (health.ok && orderBook.ok) {
    console.log('✅ Core integration tests passed!');
  } else {
    console.log('❌ Some tests failed - check server logs');
  }
}

// Run tests
runTests().catch(console.error);
