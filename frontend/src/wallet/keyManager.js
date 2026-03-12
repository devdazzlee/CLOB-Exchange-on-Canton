import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { HDKey } from '@scure/bip32';
import { generateMnemonic as scureGenerateMnemonic, mnemonicToSeedSync, validateMnemonic as scureValidateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// Fix for @noble/ed25519: Set sha512Sync function (required for browser compatibility)
// This is the ROOT CAUSE of "hashes.sha512Sync not set" error
if (!ed25519.etc.sha512Sync) {
  ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));
}

/**
 * Generate a new Ed25519 key pair
 * @returns {Promise<{publicKey: Uint8Array, privateKey: Uint8Array}>}
 */
export async function generateKeyPair() {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKey(privateKey);
  
  return {
    publicKey: publicKey,
    privateKey: privateKey
  };
}

/**
 * Generate a 12-word BIP39 mnemonic phrase
 * @returns {string} 12-word mnemonic phrase
 */
export function generateMnemonic() {
  return scureGenerateMnemonic(wordlist, 128); // 128 bits = 12 words
}

/**
 * Convert a mnemonic phrase to an Ed25519 key pair
 * Uses BIP32/BIP44 derivation path: m/44'/501'/0'/0'
 * @param {string} mnemonic - 12-word mnemonic phrase
 * @returns {Promise<{publicKey: Uint8Array, privateKey: Uint8Array}>}
 */
export async function mnemonicToKeyPair(mnemonic) {
  // Validate mnemonic
  if (!scureValidateMnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid mnemonic phrase');
  }
  
  // Convert mnemonic to seed using @scure/bip39 (browser-compatible)
  // mnemonicToSeedSync uses @noble/hashes internally - no Node.js crypto needed
  let seed;
  try {
    seed = mnemonicToSeedSync(mnemonic, '');
  } catch (error) {
    // Provide more helpful error message
    if (error.message && error.message.includes('sha512Sync')) {
      throw new Error('Crypto library not properly loaded. Please refresh the page and clear browser cache.');
    }
    throw error;
  }
  
  // Ensure seed is Uint8Array
  if (!(seed instanceof Uint8Array)) {
    throw new Error('Invalid seed type');
  }
  
  // Derive key using BIP32 with Ed25519 curve
  // Path: m/44'/501'/0'/0' (Solana-style derivation, compatible with Ed25519)
  const hdkey = HDKey.fromMasterSeed(seed);
  const derived = hdkey.derive("m/44'/501'/0'/0'");
  
  // Ed25519 uses 32-byte private keys
  const privateKey = derived.privateKey.slice(0, 32);
  const publicKey = await ed25519.getPublicKey(privateKey);
  
  return {
    publicKey: publicKey,
    privateKey: privateKey
  };
}

/**
 * Get the browser's native Web Crypto API.
 * We use window.crypto explicitly to avoid Node.js crypto polyfill interference
 * from bundled packages (e.g. buffer) that may shadow the bare `crypto` global.
 */
function getWebCrypto() {
  const wc = (typeof window !== 'undefined' && window.crypto)
    || (typeof globalThis !== 'undefined' && globalThis.crypto);
  if (!wc || !wc.subtle) {
    throw new Error(
      'Web Crypto API is not available. This can happen if the page is served over plain HTTP ' +
      '(not HTTPS or localhost). Please access the app via https:// or http://localhost.'
    );
  }
  return wc;
}

/**
 * Encrypt a private key using AES-GCM
 * @param {Uint8Array} privateKey - Private key to encrypt
 * @param {string} password - Password for encryption
 * @returns {Promise<string>} Encrypted private key as base64 string
 */
export async function encryptPrivateKey(privateKey, password) {
  const webCrypto = getWebCrypto();

  // Convert password to key using PBKDF2
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  const salt = webCrypto.getRandomValues(new Uint8Array(16));
  
  const keyMaterial = await webCrypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await webCrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Generate IV
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt the private key
  const encrypted = await webCrypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    privateKey
  );
  
  // Combine salt, iv, and encrypted data
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  
  // Convert to base64 for storage
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a private key using AES-GCM
 * @param {string} encryptedKey - Encrypted private key as base64 string
 * @param {string} password - Password for decryption
 * @returns {Promise<Uint8Array>} Decrypted private key
 */
export async function decryptPrivateKey(encryptedKey, password) {
  const webCrypto = getWebCrypto();

  // Convert from base64
  const combined = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
  
  // Extract salt, IV, and encrypted data
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  
  // Convert password to key using PBKDF2
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  
  const keyMaterial = await webCrypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await webCrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  // Decrypt the private key
  try {
    const decrypted = await webCrypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encrypted
    );
    
    return new Uint8Array(decrypted);
  } catch (error) {
    throw new Error('Failed to decrypt private key. Incorrect password?');
  }
}

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Store wallet in localStorage
 * @param {string} encryptedPrivateKey - Encrypted private key
 * @param {Uint8Array} publicKey - Public key
 */
export function storeWallet(encryptedPrivateKey, publicKey) {
  const walletData = {
    publicKey: bytesToHex(publicKey),
    encryptedPrivateKey: encryptedPrivateKey,
    timestamp: Date.now()
  };
  
  localStorage.setItem('canton_wallet', JSON.stringify(walletData));

  // Best-effort IndexedDB write (preferred storage, but keep localStorage for sync reads)
  try {
    writeWalletToIndexedDB(walletData);
  } catch {
    // ignore
  }
}

function writeWalletToIndexedDB(walletData) {
  const request = indexedDB.open('clob_wallet_db', 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('wallet')) {
      db.createObjectStore('wallet');
    }
  };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('wallet', 'readwrite');
    tx.objectStore('wallet').put(walletData, 'primary');
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  };
}

export async function loadWalletAsync() {
  // Prefer IndexedDB, fallback to localStorage
  const fromIdb = await readWalletFromIndexedDB().catch(() => null);
  if (fromIdb) {
    return {
      publicKey: hexToBytes(fromIdb.publicKey),
      encryptedPrivateKey: fromIdb.encryptedPrivateKey,
    };
  }
  return loadWallet();
}

function readWalletFromIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('clob_wallet_db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('wallet')) {
        db.createObjectStore('wallet');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('wallet', 'readonly');
      const getReq = tx.objectStore('wallet').get('primary');
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    };
  });
}

/**
 * Load wallet from localStorage
 * @returns {{publicKey: Uint8Array, encryptedPrivateKey: string} | null}
 */
export function loadWallet() {
  const walletJson = localStorage.getItem('canton_wallet');
  if (!walletJson) {
    return null;
  }
  
  try {
    const walletData = JSON.parse(walletJson);
    return {
      publicKey: hexToBytes(walletData.publicKey),
      encryptedPrivateKey: walletData.encryptedPrivateKey
    };
  } catch (error) {
    console.error('Failed to parse wallet data:', error);
    return null;
  }
}

/**
 * Clear wallet from localStorage
 */
export function clearWallet() {
  localStorage.removeItem('canton_wallet');
  // Best-effort IndexedDB clear
  try {
    const request = indexedDB.open('clob_wallet_db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('wallet')) {
        db.createObjectStore('wallet');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('wallet', 'readwrite');
      tx.objectStore('wallet').delete('primary');
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    };
  } catch {
    // ignore
  }
}

/**
 * Sign a message with a private key (Ed25519)
 * @param {Uint8Array} privateKey - Private key
 * @param {string} messageBase64 - Message to sign (base64 encoded)
 * @returns {Promise<string>} Signature as base64 string
 */
export async function signMessage(privateKey, messageBase64) {
  // Decode message from base64
  const messageBytes = Uint8Array.from(atob(messageBase64), c => c.charCodeAt(0));

  // Sign the message
  const signature = await ed25519.sign(messageBytes, privateKey);

  // Return signature as base64
  return btoa(String.fromCharCode(...signature));
}

/**
 * Convert public key to Canton Party ID format
 * @param {Uint8Array} publicKey
 * @returns {string} Party ID in format: prefix::hex
 */
export function publicKeyToPartyId(publicKey, prefix = '8100b2db-86cf-40a1-8351-55483c151cdc') {
  // Generate party ID from public key
  // The backend will create this party ID on behalf of the user
  const hex = bytesToHex(publicKey);
  return `${prefix}::${hex}`;
}

/**
 * Convert bytes to base64
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
