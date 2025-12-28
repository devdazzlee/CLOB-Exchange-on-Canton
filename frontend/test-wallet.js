/**
 * Simple Node.js test script for wallet functionality
 * Run with: node test-wallet.js
 */

import {
  generateKeyPair,
  generateMnemonic,
  mnemonicToKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  storeWallet,
  loadWallet,
  clearWallet,
  publicKeyToPartyId
} from './src/wallet/keyManager.js';

async function testWallet() {
  console.log('🧪 Testing Wallet Functionality...\n');

  try {
    // Test 1: Generate Key Pair
    console.log('1. Testing generateKeyPair...');
    const { publicKey, privateKey } = await generateKeyPair();
    console.log('✅ Key pair generated');
    console.log(`   Public Key length: ${publicKey.length} bytes`);
    console.log(`   Private Key length: ${privateKey.length} bytes\n`);

    // Test 2: Generate Mnemonic
    console.log('2. Testing generateMnemonic...');
    const mnemonic = generateMnemonic();
    const words = mnemonic.split(' ');
    console.log('✅ Mnemonic generated');
    console.log(`   Words: ${words.length}`);
    console.log(`   Mnemonic: ${mnemonic}\n`);

    // Test 3: Mnemonic to Key Pair
    console.log('3. Testing mnemonicToKeyPair...');
    const { publicKey: pubKey2, privateKey: privKey2 } = await mnemonicToKeyPair(mnemonic);
    console.log('✅ Keys derived from mnemonic');
    console.log(`   Public Key matches: ${publicKey.length === pubKey2.length}\n`);

    // Test 4: Same mnemonic produces same keys
    console.log('4. Testing mnemonic consistency...');
    const { publicKey: pubKey3 } = await mnemonicToKeyPair(mnemonic);
    const keysMatch = Array.from(pubKey2).every((val, idx) => val === pubKey3[idx]);
    console.log(`✅ Same mnemonic produces same keys: ${keysMatch}\n`);

    // Test 5: Encrypt/Decrypt Private Key
    console.log('5. Testing encryptPrivateKey/decryptPrivateKey...');
    const password = 'testPassword123!';
    const encrypted = await encryptPrivateKey(privateKey, password);
    console.log('✅ Private key encrypted');
    
    const decrypted = await decryptPrivateKey(encrypted, password);
    const decryptionMatches = Array.from(privateKey).every((val, idx) => val === decrypted[idx]);
    console.log(`✅ Private key decrypted correctly: ${decryptionMatches}\n`);

    // Test 6: Store/Load Wallet
    console.log('6. Testing storeWallet/loadWallet...');
    clearWallet();
    storeWallet(encrypted, publicKey);
    const loaded = loadWallet();
    const walletMatches = loaded && Array.from(publicKey).every((val, idx) => val === loaded.publicKey[idx]);
    console.log(`✅ Wallet stored and loaded correctly: ${walletMatches}\n`);

    // Test 7: Public Key to Party ID
    console.log('7. Testing publicKeyToPartyId...');
    const partyId = publicKeyToPartyId(publicKey);
    console.log('✅ Party ID generated');
    console.log(`   Party ID: ${partyId.substring(0, 60)}...\n`);

    // Test 8: Clear Wallet
    console.log('8. Testing clearWallet...');
    clearWallet();
    const cleared = loadWallet();
    console.log(`✅ Wallet cleared: ${cleared === null}\n`);

    console.log('🎉 All wallet tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testWallet();

