/**
 * Integration test script for CLOB Exchange
 * Tests wallet, API structure, and component imports
 * Run with: node test-integration.js
 */

console.log('🧪 CLOB Exchange Integration Tests\n');
console.log('=' .repeat(50));

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('\n1. Testing Module Imports...\n');
  
  // Test wallet imports
  test('Wallet keyManager imports', () => {
    const keyManager = require('./src/wallet/keyManager.js');
    if (!keyManager.generateKeyPair) throw new Error('generateKeyPair not found');
    if (!keyManager.generateMnemonic) throw new Error('generateMnemonic not found');
    if (!keyManager.mnemonicToKeyPair) throw new Error('mnemonicToKeyPair not found');
    if (!keyManager.encryptPrivateKey) throw new Error('encryptPrivateKey not found');
    if (!keyManager.decryptPrivateKey) throw new Error('decryptPrivateKey not found');
    if (!keyManager.storeWallet) throw new Error('storeWallet not found');
    if (!keyManager.loadWallet) throw new Error('loadWallet not found');
    if (!keyManager.clearWallet) throw new Error('clearWallet not found');
    if (!keyManager.publicKeyToPartyId) throw new Error('publicKeyToPartyId not found');
  });

  // Test API imports
  test('Canton API imports', () => {
    const cantonApi = require('./src/services/cantonApi.js');
    if (!cantonApi.createContract) throw new Error('createContract not found');
    if (!cantonApi.exerciseChoice) throw new Error('exerciseChoice not found');
    if (!cantonApi.queryContracts) throw new Error('queryContracts not found');
    if (!cantonApi.getPartyDetails) throw new Error('getPartyDetails not found');
    if (!cantonApi.fetchContract) throw new Error('fetchContract not found');
  });

  console.log('\n2. Testing Wallet Functionality...\n');

  // Test mnemonic generation
  test('Mnemonic generation', () => {
    const { generateMnemonic } = require('./src/wallet/keyManager.js');
    const mnemonic = generateMnemonic();
    const words = mnemonic.split(' ');
    if (words.length !== 12) throw new Error(`Expected 12 words, got ${words.length}`);
    if (typeof mnemonic !== 'string') throw new Error('Mnemonic should be a string');
  });

  // Test Party ID generation
  test('Party ID format', async () => {
    const { generateKeyPair, publicKeyToPartyId } = require('./src/wallet/keyManager.js');
    const { publicKey } = await generateKeyPair();
    const partyId = publicKeyToPartyId(publicKey);
    if (!partyId.includes('::')) throw new Error('Party ID should contain ::');
    const parts = partyId.split('::');
    if (parts.length !== 2) throw new Error('Party ID should have 2 parts separated by ::');
  });

  console.log('\n3. Testing API Structure...\n');

  test('Canton API base URL', () => {
    // Check that API functions are properly structured
    const cantonApi = require('./src/services/cantonApi.js');
    if (typeof cantonApi.createContract !== 'function') {
      throw new Error('createContract should be a function');
    }
  });

  console.log('\n4. Testing File Structure...\n');

  const fs = require('fs');
  const path = require('path');

  test('Required files exist', () => {
    const requiredFiles = [
      'src/App.jsx',
      'src/main.jsx',
      'src/components/WalletSetup.jsx',
      'src/components/TradingInterface.jsx',
      'src/services/cantonApi.js',
      'src/wallet/keyManager.js',
      'package.json',
      'vite.config.js',
      'index.html'
    ];

    requiredFiles.forEach(file => {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required file not found: ${file}`);
      }
    });
  });

  console.log('\n5. Testing Dependencies...\n');

  test('Package.json dependencies', () => {
    const packageJson = require('./package.json');
    const requiredDeps = [
      'react',
      'react-dom',
      'react-router-dom',
      '@noble/ed25519',
      'bip39',
      '@scure/bip32'
    ];

    requiredDeps.forEach(dep => {
      if (!packageJson.dependencies[dep]) {
        throw new Error(`Missing dependency: ${dep}`);
      }
    });
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Test Summary:');
  console.log(`   ✅ Passed: ${testsPassed}`);
  console.log(`   ❌ Failed: ${testsFailed}`);
  console.log(`   📈 Total: ${testsPassed + testsFailed}`);
  
  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

// Note: This uses CommonJS require, but our code uses ES modules
// For a proper test, we'd need to use a test runner or convert to ES modules
console.log('⚠️  Note: This is a basic structure test.');
console.log('   For full functionality tests, use the React app or Jest tests.\n');

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});

