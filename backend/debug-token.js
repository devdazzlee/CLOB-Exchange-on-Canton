/**
 * Debug admin token issue
 * 
 * Uses centralized constants for all values
 */

const cantonService = require('./src/services/cantonService');
const { 
  OPERATOR_PARTY_ID, 
  CANTON_JSON_API_BASE,
  DEFAULT_SYNCHRONIZER_ID 
} = require('./src/config/constants');

async function debugToken() {
  try {
    console.log('🔍 Starting admin token debug...');
    console.log('📋 Config: Operator Party ID:', OPERATOR_PARTY_ID.substring(0, 30) + '...');
    console.log('📋 Config: Canton API:', CANTON_JSON_API_BASE);
    console.log('📋 Config: Synchronizer:', DEFAULT_SYNCHRONIZER_ID.substring(0, 30) + '...');
    
    // Test 1: Get admin token
    console.log('\n1. Testing admin token fetch...');
    const adminToken = await cantonService.getAdminToken();
    console.log('✓ Admin token obtained successfully');
    console.log('✓ Token length:', adminToken.length);
    console.log('✓ Token starts with:', adminToken.substring(0, 30) + '...');
    
    // Test 2: Test simple Canton API call
    console.log('\n2. Testing Canton API connectivity...');
    const testResponse = await fetch(`${CANTON_JSON_API_BASE}/v2/packages`, {
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
        actAsParty: [OPERATOR_PARTY_ID],
        templateId: 'test:Template:Test',
        createArguments: {},
        synchronizerId: DEFAULT_SYNCHRONIZER_ID,
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
