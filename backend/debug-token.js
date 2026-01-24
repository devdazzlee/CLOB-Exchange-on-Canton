/**
 * Debug admin token issue
 */

const cantonService = require('./src/services/cantonService');

async function debugToken() {
  try {
    console.log('🔍 Starting admin token debug...');
    
    // Test 1: Get admin token
    console.log('\n1. Testing admin token fetch...');
    const adminToken = await cantonService.getAdminToken();
    console.log('✓ Admin token obtained successfully');
    console.log('✓ Token length:', adminToken.length);
    console.log('✓ Token starts with:', adminToken.substring(0, 30) + '...');
    
    // Test 2: Test simple Canton API call
    console.log('\n2. Testing Canton API connectivity...');
    const testResponse = await fetch('http://65.108.40.104:31539/v2/packages', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (testResponse.ok) {
      const data = await testResponse.json();
      console.log('✓ Canton API call successful');
      console.log('✓ Packages available:', data.length || 'unknown');
    } else {
      const errorText = await testResponse.text();
      console.log('✗ Canton API call failed:', testResponse.status);
      console.log('✗ Error details:', errorText);
    }
    
    // Test 3: Test the exact createContract call that's failing
    console.log('\n3. Testing createContract call...');
    try {
      const result = await cantonService.createContract({
        token: adminToken,
        actAsParty: ['8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292'],
        templateId: 'test:Template:Test',
        createArguments: {},
        synchronizerId: 'global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a',
      });
      console.log('✗ This should fail but we can see the exact error');
    } catch (createError) {
      console.log('✓ Expected createContract error:', createError.message);
    }
    
  } catch (error) {
    console.error('✗ Debug failed:', error.message);
    console.error('✗ Full error:', error);
  }
}

debugToken();
