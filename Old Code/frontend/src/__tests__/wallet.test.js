/**
 * Test file for wallet functionality
 * Run with: yarn test or node --experimental-vm-modules node_modules/jest/bin/jest.js
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
} from '../wallet/keyManager';

describe('Wallet Key Manager', () => {
  test('generateKeyPair should create valid Ed25519 key pair', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
    expect(privateKey.length).toBe(32);
  });

  test('generateMnemonic should create 12-word phrase', () => {
    const mnemonic = generateMnemonic();
    const words = mnemonic.split(' ');
    
    expect(words.length).toBe(12);
    expect(typeof mnemonic).toBe('string');
  });

  test('mnemonicToKeyPair should derive keys from mnemonic', async () => {
    const mnemonic = generateMnemonic();
    const { publicKey, privateKey } = await mnemonicToKeyPair(mnemonic);
    
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
    expect(privateKey.length).toBe(32);
  });

  test('mnemonicToKeyPair should reject invalid mnemonic', async () => {
    const invalidMnemonic = 'invalid mnemonic phrase test';
    
    await expect(mnemonicToKeyPair(invalidMnemonic)).rejects.toThrow();
  });

  test('encryptPrivateKey and decryptPrivateKey should work correctly', async () => {
    const { privateKey } = await generateKeyPair();
    const password = 'testPassword123';
    
    const encrypted = await encryptPrivateKey(privateKey, password);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
    
    const decrypted = await decryptPrivateKey(encrypted, password);
    expect(decrypted).toBeInstanceOf(Uint8Array);
    expect(decrypted.length).toBe(32);
    expect(Array.from(decrypted)).toEqual(Array.from(privateKey));
  });

  test('decryptPrivateKey should fail with wrong password', async () => {
    const { privateKey } = await generateKeyPair();
    const password = 'testPassword123';
    const wrongPassword = 'wrongPassword';
    
    const encrypted = await encryptPrivateKey(privateKey, password);
    
    await expect(decryptPrivateKey(encrypted, wrongPassword)).rejects.toThrow();
  });

  test('storeWallet and loadWallet should work correctly', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const password = 'testPassword123';
    const encrypted = await encryptPrivateKey(privateKey, password);
    
    // Clear any existing wallet
    clearWallet();
    
    storeWallet(encrypted, publicKey);
    const loaded = loadWallet();
    
    expect(loaded).not.toBeNull();
    expect(loaded.publicKey).toBeInstanceOf(Uint8Array);
    expect(loaded.encryptedPrivateKey).toBe(encrypted);
    expect(Array.from(loaded.publicKey)).toEqual(Array.from(publicKey));
  });

  test('clearWallet should remove wallet from storage', async () => {
    const { publicKey } = await generateKeyPair();
    const encrypted = 'testEncrypted';
    
    storeWallet(encrypted, publicKey);
    expect(loadWallet()).not.toBeNull();
    
    clearWallet();
    expect(loadWallet()).toBeNull();
  });

  test('publicKeyToPartyId should format correctly', async () => {
    const { publicKey } = await generateKeyPair();
    const partyId = publicKeyToPartyId(publicKey);
    
    expect(typeof partyId).toBe('string');
    expect(partyId).toContain('::');
    expect(partyId.split('::').length).toBe(2);
  });

  test('same mnemonic should generate same key pair', async () => {
    const mnemonic = generateMnemonic();
    const keyPair1 = await mnemonicToKeyPair(mnemonic);
    const keyPair2 = await mnemonicToKeyPair(mnemonic);
    
    expect(Array.from(keyPair1.publicKey)).toEqual(Array.from(keyPair2.publicKey));
    expect(Array.from(keyPair1.privateKey)).toEqual(Array.from(keyPair2.privateKey));
  });
});

