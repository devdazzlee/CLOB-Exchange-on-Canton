/**
 * Upload DAR file using backend's admin token
 * This ensures we use the same authentication as the backend
 */

require('dotenv').config({ path: './backend/.env' });
const fs = require('fs');
const path = require('path');

async function uploadDAR() {
  try {
    // Get admin token using backend's method
    const CantonAdmin = require('./backend/canton-admin');
    const admin = new CantonAdmin();
    const token = await admin.getAdminToken();
    
    console.log('✅ Got admin token');
    
    // Read DAR file
    const darPath = path.join(__dirname, '.daml/dist/clob-exchange-1.0.0.dar');
    if (!fs.existsSync(darPath)) {
      throw new Error(`DAR file not found: ${darPath}`);
    }
    
    console.log(`📦 Reading DAR file: ${darPath}`);
    const darBuffer = fs.readFileSync(darPath);
    const base64Dar = darBuffer.toString('base64');
    
    // Upload via gRPC
    const { execSync } = require('child_process');
    
    // Check if grpcurl is available
    try {
      execSync('which grpcurl', { stdio: 'ignore' });
    } catch {
      throw new Error('grpcurl not found. Install with: brew install grpcurl');
    }
    
    // Create JSON request
    const requestJson = JSON.stringify({
      dars: [{
        bytes: base64Dar
      }],
      vet_all_packages: true,
      synchronize_vetting: true
    });
    
    console.log('📤 Uploading DAR to Canton...');
    
    const result = execSync(
      `echo '${requestJson.replace(/'/g, "'\\''")}' | grpcurl -H "Authorization: Bearer ${token}" -d @ participant.dev.canton.wolfedgelabs.com:443 com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    
    console.log('✅ Upload result:');
    console.log(result);
    
    // Wait a moment for processing
    console.log('\n⏳ Waiting 5 seconds for Canton to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('\n✅ DAR upload complete!');
    console.log('Now run: cd backend && npm run init-orderbooks');
    
  } catch (error) {
    if (error.message.includes('KNOWN_PACKAGE_VERSION') || error.message.includes('duplicate')) {
      console.log('✅ DAR is already uploaded (duplicate detected)');
      console.log('This is OK - the DAR exists on Canton');
      console.log('\nNow run: cd backend && npm run init-orderbooks');
    } else {
      console.error('❌ Error:', error.message);
      if (error.stdout) console.error('Output:', error.stdout);
      if (error.stderr) console.error('Error:', error.stderr);
      process.exit(1);
    }
  }
}

uploadDAR();

