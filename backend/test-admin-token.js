/**
 * Test script to verify admin token works
 */

const cantonService = require('./src/services/cantonService');

async function testAdminToken() {
  try {
    console.log('Testing admin token...');
    
    // Get admin token
    const adminToken = await cantonService.getAdminToken();
    console.log('✓ Admin token obtained successfully');
    console.log('Token length:', adminToken.length);
    
    // Test a simple Canton API call
    const response = await fetch('http://65.108.40.104:31539/v2/packages', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✓ Canton API call successful');
      console.log('Packages count:', data.length || 'unknown');
    } else {
      const errorText = await response.text();
      console.log('✗ Canton API call failed:', response.status, errorText);
    }
    
  } catch (error) {
    console.error('✗ Test failed:', error.message);
  }
}

testAdminToken();
