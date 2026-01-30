// Test the /api/onboarding/allocate-party endpoint
const fetch = require('node-fetch');

const API_BASE_URL = 'http://localhost:3001/api';

async function test() {
  console.log('Testing /api/onboarding/allocate-party endpoint...\n');
  
  // Test Step 1: Generate topology
  const publicKeyBase64 = Buffer.from('test-public-key-' + Date.now()).toString('base64');
  
  try {
    console.log('Step 1: Generate topology');
    console.log('URL:', `${API_BASE_URL}/onboarding/allocate-party`);
    console.log('Body:', { publicKeyBase64 });
    
    const response = await fetch(`${API_BASE_URL}/onboarding/allocate-party`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'test-user-' + Date.now()
      },
      body: JSON.stringify({
        publicKeyBase64
      })
    });
    
    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    
    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
