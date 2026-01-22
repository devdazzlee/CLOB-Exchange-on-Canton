/**
 * Test script to verify server endpoints
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';

function testEndpoint(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body,
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Backend Endpoints...\n');

  // Test 1: Health endpoint
  try {
    console.log('1. Testing GET /health...');
    const health = await testEndpoint('GET', '/health');
    console.log(`   ✅ Status: ${health.status}`);
    console.log(`   Response: ${health.body.substring(0, 100)}...\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }

  // Test 2: Test routes endpoint
  try {
    console.log('2. Testing GET /api/test-routes...');
    const testRoutes = await testEndpoint('GET', '/api/test-routes');
    console.log(`   ✅ Status: ${testRoutes.status}`);
    console.log(`   Response: ${testRoutes.body.substring(0, 200)}...\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }

  // Test 3: Create party endpoint (GET test)
  try {
    console.log('3. Testing GET /api/create-party (test route)...');
    const getParty = await testEndpoint('GET', '/api/create-party');
    console.log(`   ✅ Status: ${getParty.status}`);
    console.log(`   Response: ${getParty.body.substring(0, 200)}...\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }

  // Test 4: Create party endpoint (POST)
  try {
    console.log('4. Testing POST /api/create-party...');
    const postParty = await testEndpoint('POST', '/api/create-party', {
      publicKeyHex: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });
    console.log(`   ✅ Status: ${postParty.status}`);
    console.log(`   Response: ${postParty.body.substring(0, 300)}...\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }

  console.log('✅ All tests completed!');
}

// Run tests
runTests().catch(console.error);
