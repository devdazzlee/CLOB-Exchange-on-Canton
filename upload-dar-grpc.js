#!/usr/bin/env node
/**
 * Upload DAR using gRPC (the working method)
 * Uses backend's authentication
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend/.env') });

const fs = require('fs');
const { execSync } = require('child_process');
const CantonAdminService = require('./backend/canton-admin');

async function uploadDAR() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          CLOB Exchange - DAR Upload (gRPC Method)             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Find DAR file
  const darPaths = [
    '.daml/dist/clob-exchange-utxo-1.0.0.dar',
    '.daml/dist/clob-exchange-1.0.0.dar'
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
    console.error('Run "daml build" first');
    process.exit(1);
  }

  const stats = fs.statSync(darFile);
  console.log(`📦 DAR file: ${darFile}`);
  console.log(`📏 Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log('');

  // Check if grpcurl is installed
  try {
    execSync('which grpcurl', { stdio: 'ignore' });
  } catch {
    console.error('❌ grpcurl is not installed');
    console.error('Install with: brew install grpcurl (macOS)');
    process.exit(1);
  }

  // Check if jq is installed
  try {
    execSync('which jq', { stdio: 'ignore' });
  } catch {
    console.error('❌ jq is not installed');
    console.error('Install with: brew install jq (macOS)');
    process.exit(1);
  }

  // Get admin token
  console.log('🔑 Getting admin token...');
  const cantonAdmin = new CantonAdminService();
  const adminToken = await cantonAdmin.getAdminToken();
  console.log(`✅ Got admin token (${adminToken.length} chars)`);
  console.log('');

  // Base64 encode DAR
  console.log('📤 Encoding and uploading DAR...');
  const base64Dar = fs.readFileSync(darFile).toString('base64');

  // Create gRPC request JSON
  const grpcRequest = {
    dars: [{ bytes: base64Dar }],
    vet_all_packages: true,
    synchronize_vetting: true
  };

  const requestFile = '/tmp/grpc-upload-request.json';
  fs.writeFileSync(requestFile, JSON.stringify(grpcRequest));

  // Upload via gRPC
  try {
    const response = execSync(
      `grpcurl -H "Authorization: Bearer ${adminToken}" -d @ participant.dev.canton.wolfedgelabs.com:443 com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar < ${requestFile}`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    console.log('✅ DAR uploaded successfully!');
    console.log('');
    console.log('Response:');
    try {
      const json = JSON.parse(response);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(response);
    }
    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('✅ SUCCESS! MasterOrderBook template is now on the ledger');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart your backend: cd backend && npm restart');
    console.log('2. Run deployment script: node scripts/deploymentScript.js');
    console.log('════════════════════════════════════════════════════════════════');

    // Cleanup
    fs.unlinkSync(requestFile);
  } catch (error) {
    console.error('❌ Upload failed');
    console.error('Error:', error.message);
    if (error.stdout) console.error('Output:', error.stdout);
    if (error.stderr) console.error('Stderr:', error.stderr);
    process.exit(1);
  }
}

uploadDAR().catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
