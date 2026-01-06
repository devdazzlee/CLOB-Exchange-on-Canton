/**
 * Debug script to test Keycloak password grant directly
 * Run with: node debug-password-grant.js <username> <password>
 * 
 * This script helps diagnose why token generation is failing
 */

const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'https://keycloak.wolfedgelabs.com:8443';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'canton-devnet';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'Clob';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || null;

async function testPasswordGrant(username, password) {
  console.log('='.repeat(80));
  console.log('Keycloak Password Grant Debug Test');
  console.log('='.repeat(80));
  console.log('');
  console.log('Configuration:');
  console.log('  KEYCLOAK_BASE_URL:', KEYCLOAK_BASE_URL);
  console.log('  KEYCLOAK_REALM:', KEYCLOAK_REALM);
  console.log('  KEYCLOAK_CLIENT_ID:', KEYCLOAK_CLIENT_ID);
  console.log('  KEYCLOAK_CLIENT_SECRET:', KEYCLOAK_CLIENT_SECRET ? '***SET***' : 'NOT SET (public client)');
  console.log('  Username:', username);
  console.log('  Password:', password ? '***SET***' : 'NOT SET');
  console.log('');

  const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  console.log('Token URL:', tokenUrl);
  console.log('');

  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: KEYCLOAK_CLIENT_ID,
    username: username,
    password: password,
    scope: 'openid profile email daml_ledger_api',
  });

  if (KEYCLOAK_CLIENT_SECRET) {
    params.append('client_secret', KEYCLOAK_CLIENT_SECRET);
  }

  console.log('Request parameters:');
  console.log('  grant_type: password');
  console.log('  client_id:', KEYCLOAK_CLIENT_ID);
  console.log('  username:', username);
  console.log('  password:', password ? '***SET***' : 'NOT SET');
  console.log('  scope: openid profile email daml_ledger_api');
  if (KEYCLOAK_CLIENT_SECRET) {
    console.log('  client_secret: ***SET***');
  }
  console.log('');

  try {
    console.log('Sending request to Keycloak...');
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    console.log('Response status:', response.status, response.statusText);
    console.log('Response headers:');
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
    console.log('');

    const responseText = await response.text();
    console.log('Response body length:', responseText.length);
    console.log('Response body:');
    console.log(responseText);
    console.log('');

    if (response.ok) {
      try {
        const data = JSON.parse(responseText);
        console.log('Parsed response:');
        console.log(JSON.stringify(data, null, 2));
        console.log('');

        if (data.access_token) {
          console.log('✓ SUCCESS: access_token received');
          console.log('  Token length:', data.access_token.length);
          console.log('  Token preview:', data.access_token.substring(0, 50) + '...');
          
          // Decode token
          try {
            const parts = data.access_token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
              console.log('');
              console.log('Token payload:');
              console.log('  sub:', payload.sub);
              console.log('  iss:', payload.iss);
              console.log('  aud:', payload.aud);
              console.log('  scope:', payload.scope);
              console.log('  exp:', new Date(payload.exp * 1000).toISOString());
              if (payload.attributes) {
                console.log('  attributes:', payload.attributes);
              }
            }
          } catch (e) {
            console.warn('Could not decode token:', e.message);
          }
        } else {
          console.error('✗ ERROR: Response is OK but access_token is missing');
          console.error('Response keys:', Object.keys(data));
        }
      } catch (parseError) {
        console.error('✗ ERROR: Failed to parse response as JSON');
        console.error('Parse error:', parseError.message);
      }
    } else {
      console.error('✗ ERROR: Request failed');
      try {
        const errorData = JSON.parse(responseText);
        console.error('Error code:', errorData.error);
        console.error('Error description:', errorData.error_description);
      } catch (e) {
        console.error('Error response (not JSON):', responseText);
      }
    }
  } catch (error) {
    console.error('✗ EXCEPTION:', error.message);
    console.error('Stack:', error.stack);
  }

  console.log('');
  console.log('='.repeat(80));
}

// Get command line arguments
const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Usage: node debug-password-grant.js <username> <password>');
  console.error('');
  console.error('Example:');
  console.error('  node debug-password-grant.js party_1234567890abcdef abc123def456');
  process.exit(1);
}

testPasswordGrant(username, password).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

