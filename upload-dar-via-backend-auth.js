#!/usr/bin/env node
/**
 * Upload DAR using the backend's working authentication
 * This uses the same canton-admin.js module that the backend uses
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend/.env') });

const fs = require('fs');
const path = require('path');
const CantonAdminService = require('./backend/canton-admin');

// Use the HTTPS endpoint (not the IP from .env)
const CANTON_UPLOAD_URL = 'https://participant.dev.canton.wolfedgelabs.com/v1/packages';

async function uploadDAR() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          CLOB Exchange - DAR Upload (Backend Auth)            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Find DAR file
  const darPaths = [
    '.daml/dist/clob-exchange-utxo-1.0.0.dar',
    '.daml/dist/clob-exchange-1.0.0.dar',
    'daml/.daml/dist/clob-exchange-utxo-1.0.0.dar',
    'daml/.daml/dist/clob-exchange-1.0.0.dar'
  ];

  let darFile = null;
  for (const darPath of darPaths) {
    if (fs.existsSync(darPath)) {
      darFile = darPath;
      break;
    }
  }

  if (!darFile) {
    console.error('❌ DAR file not found');
    console.error('Expected: .daml/dist/clob-exchange-utxo-1.0.0.dar');
    console.error('Run "daml build" first to create the DAR file');
    process.exit(1);
  }

  const stats = fs.statSync(darFile);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`📦 DAR file: ${darFile}`);
  console.log(`📏 Size: ${sizeMB} MB`);
  console.log('');

  // Step 1: Get admin token using backend's working method
  console.log('🔑 Step 1: Getting admin token via canton-admin...');
  const cantonAdmin = new CantonAdminService();
  
  let adminToken;
  try {
    adminToken = await cantonAdmin.getAdminToken();
    console.log(`✅ Got admin token (${adminToken.length} chars)`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to get admin token:', error.message);
    console.error('');
    console.error('Make sure your backend/.env file has:');
    console.error('  KEYCLOAK_ADMIN_CLIENT_ID=...');
    console.error('  KEYCLOAK_ADMIN_CLIENT_SECRET=...');
    process.exit(1);
  }

  // Step 2: Upload DAR
  console.log('📤 Step 2: Uploading DAR to Canton...');
  console.log(`   URL: ${CANTON_UPLOAD_URL}`);
  console.log('');

  const darBuffer = fs.readFileSync(darFile);

  try {
    // Use the correct DAR MIME type
    const response = await fetch(CANTON_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/vnd.daml.dar'
      },
      body: darBuffer
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    console.log(`HTTP Status: ${response.status}`);

    if (response.ok) {
      console.log('✅ DAR uploaded successfully!');
      console.log('');
      console.log('Response:', JSON.stringify(responseData, null, 2));
      console.log('');
      console.log('════════════════════════════════════════════════════════════════');
      console.log('✅ SUCCESS! MasterOrderBook template is now on the ledger');
      console.log('');
      console.log('Next steps:');
      console.log('1. Restart your backend: cd backend && npm restart');
      console.log('2. Run deployment script: node scripts/deploymentScript.js');
      console.log('════════════════════════════════════════════════════════════════');
      process.exit(0);
    } else if (response.status === 409) {
      console.log('ℹ️  DAR already uploaded (409 Conflict)');
      console.log('This is fine - the package already exists on the ledger');
      console.log('');
      console.log('Response:', responseText);
      console.log('');
      console.log('════════════════════════════════════════════════════════════════');
      console.log('ℹ️  Package already deployed - you can proceed with deployment');
      console.log('════════════════════════════════════════════════════════════════');
      process.exit(0);
    } else {
      console.error('❌ Upload failed');
      console.error(`Status: ${response.status}`);
      console.error('Response:', responseText);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Upload error:', error.message);
    process.exit(1);
  }
}

uploadDAR();
