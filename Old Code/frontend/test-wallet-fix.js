// Quick test to verify wallet functions work
import { generateMnemonic, mnemonicToKeyPair } from './src/wallet/keyManager.js';

async function test() {
  try {
    console.log('Testing generateMnemonic...');
    const mnemonic = generateMnemonic();
    console.log('✅ Mnemonic generated:', mnemonic.substring(0, 30) + '...');
    
    console.log('Testing mnemonicToKeyPair...');
    const { publicKey, privateKey } = await mnemonicToKeyPair(mnemonic);
    console.log('✅ Key pair generated');
    console.log('Public key length:', publicKey.length);
    console.log('Private key length:', privateKey.length);
    
    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

test();
