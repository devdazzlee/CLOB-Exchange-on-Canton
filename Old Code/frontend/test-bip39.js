// Test @scure/bip39 directly
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

try {
  console.log('Testing generateMnemonic...');
  const mnemonic = generateMnemonic(wordlist, 128);
  console.log('✅ Mnemonic:', mnemonic);
  
  console.log('Testing mnemonicToSeedSync...');
  const seed = mnemonicToSeedSync(mnemonic, '');
  console.log('✅ Seed length:', seed.length);
  console.log('✅ SUCCESS!');
} catch (error) {
  console.error('❌ ERROR:', error.message);
  console.error(error.stack);
}
