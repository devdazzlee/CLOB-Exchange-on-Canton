/**
 * upload-dar-node.js
 * Uploads and vets a DAR to Canton via JSON API v2
 * Usage: node scripts/upload-dar-node.js [dar-path]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// Disable TLS verification for devnet
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const DAR_PATH = process.argv[2] || path.join(__dirname, '..', 'dars', 'clob-exchange-splice-1.1.0.dar');
const CANTON_URL = process.env.CANTON_JSON_LEDGER_API_BASE || 'http://65.108.40.104:31539';
const KEYCLOAK_URL = process.env.KEYCLOAK_TOKEN_URL || 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token';
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'Sesnp3u6udkFF983rfprvsBbx3X3mBpw';
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || 'mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYc';

async function getToken() {
  console.log('[1/3] Getting service token from Keycloak...');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }).toString();

  const res = await fetch(KEYCLOAK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token fetch failed: ${JSON.stringify(data)}`);
  console.log(`     ✅ Token obtained (length: ${data.access_token.length})`);
  return data.access_token;
}

async function uploadDar(token, darPath) {
  console.log(`[2/3] Uploading DAR: ${path.basename(darPath)}`);
  // Canton JSON API v2 expects raw binary bytes with application/octet-stream
  const darBytes = fs.readFileSync(darPath);
  
  const res = await fetch(`${CANTON_URL}/v2/packages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: darBytes,
  });
  
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  
  console.log(`     Response status: ${res.status}`);
  console.log(`     Response: ${JSON.stringify(data, null, 2)}`);
  
  if (!res.ok) {
    // 409 = already uploaded — that's OK, continue to vet
    if (res.status === 409 || text.includes('PACKAGE_ALREADY_EXISTS') || text.includes('already')) {
      console.log('     ℹ️  Package already uploaded — continuing to vet step');
      return data;
    }
    throw new Error(`DAR upload failed (${res.status}): ${text}`);
  }
  
  console.log('     ✅ DAR uploaded successfully');
  return data;
}

async function vetPackages(token) {
  console.log('[3/3] Vetting all packages...');
  
  // First list packages to find our new one
  const listRes = await fetch(`${CANTON_URL}/v2/packages`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const listData = await listRes.json();
  const packageIds = listData.packageIds || listData.packages || [];
  console.log(`     Found ${packageIds.length} total packages on ledger`);
  
  // Try to vet all packages
  try {
    const vetRes = await fetch(`${CANTON_URL}/v2/packages/vet`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const vetText = await vetRes.text();
    console.log(`     Vet response (${vetRes.status}): ${vetText.substring(0, 200)}`);
    if (vetRes.ok) {
      console.log('     ✅ Packages vetted');
    } else {
      console.log('     ⚠️  Vet endpoint returned non-200 (may need manual vetting via Canton console)');
    }
  } catch (vetErr) {
    console.log(`     ⚠️  Vet step failed: ${vetErr.message} — may need manual vetting`);
  }
  
  return packageIds;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' CLOB Exchange — DAR Upload & Vet');
  console.log('═══════════════════════════════════════════════════');
  console.log(` DAR:    ${DAR_PATH}`);
  console.log(` Canton: ${CANTON_URL}`);
  console.log('');
  
  if (!fs.existsSync(DAR_PATH)) {
    console.error(`❌ DAR file not found: ${DAR_PATH}`);
    process.exit(1);
  }
  
  const darSize = fs.statSync(DAR_PATH).size;
  console.log(` Size:   ${(darSize / 1024).toFixed(1)} KB\n`);
  
  try {
    const token = await getToken();
    const uploadResult = await uploadDar(token, DAR_PATH);
    const packageIds = await vetPackages(token);
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' ✅ Complete!');
    console.log('═══════════════════════════════════════════════════');
    console.log('\nNext steps:');
    console.log('1. Update CLOB_EXCHANGE_PACKAGE_ID in backend/.env with the new package ID');
    console.log('2. Restart the backend: npm run start');
    console.log('3. Test settlement via the matching engine');
    
    // Show package IDs list so user can identify the new one
    if (packageIds.length > 0) {
      console.log('\nAll package IDs on ledger:');
      const ids = Array.isArray(packageIds) ? packageIds : Object.keys(packageIds);
      ids.slice(-5).forEach(id => console.log(`  ${id}`));
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
