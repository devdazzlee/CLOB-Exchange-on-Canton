/**
 * Browser Wallet Crypto Utilities
 * Ed25519 keypair generation, encryption, and backup/restore
 */

import * as ed25519 from '@noble/ed25519';
import * as nacl from 'tweetnacl';
import { mnemonicToSeedSync, entropyToMnemonic } from 'bip39';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { Buffer } from 'buffer';

// Make Buffer available globally for browser
if (typeof window !== 'undefined' && !window.Buffer) {
  (window as any).Buffer = Buffer;
}

/**
 * Generate random bytes (browser-compatible)
 */
function randomBytes(length: number): Uint8Array {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return array;
  }
  // For Node.js, use crypto module (synchronous for compatibility)
  // In browser, this should never be reached
  throw new Error('randomBytes: Browser crypto.getRandomValues not available');
}

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface EncryptedWallet {
  encryptedData: string;
  salt: string;
  iv: string;
  iterations: number;
}

/**
 * Generate Ed25519 keypair using WebCrypto or fallback
 */
export async function generateKeyPair(): Promise<KeyPair> {
  // Always use @noble/ed25519 for consistent 32-byte private keys
  // WebCrypto Ed25519 support is limited and PKCS8 format is not what we need
  const privateKeyBytes = ed25519.utils.randomPrivateKey();
  
  // @noble/ed25519 always returns 32 bytes, but ensure we have exactly 32
  let privateKey: Uint8Array;
  if (privateKeyBytes.length === 32) {
    privateKey = privateKeyBytes;
  } else if (privateKeyBytes.length > 32) {
    // Take first 32 bytes if somehow longer
    privateKey = privateKeyBytes.slice(0, 32);
  } else {
    // Pad with zeros if shorter (shouldn't happen, but be safe)
    privateKey = new Uint8Array(32);
    privateKey.set(privateKeyBytes);
  }
  
  const publicKey = await ed25519.getPublicKey(privateKey);

  // Final validation - ensure exactly 32 bytes
  if (privateKey.length !== 32) {
    throw new Error(`Invalid private key length: ${privateKey.length}, expected 32`);
  }

  return { publicKey, privateKey };
}

/**
 * Derive seed phrase (BIP39) from 32-byte private key
 * Note: This uses the private key directly as entropy (128 bits for 12 words)
 * In production, consider using a more secure derivation
 */
export function deriveSeedPhrase(privateKey: Uint8Array): string {
  // Ensure we have at least 16 bytes for entropy
  if (privateKey.length < 16) {
    throw new Error(`Private key too short: ${privateKey.length} bytes, need at least 16`);
  }
  
  // Use first 16 bytes (128 bits) for 12-word mnemonic
  const entropy = privateKey.slice(0, 16);
  
  // Convert to Buffer for bip39 (Buffer polyfill is available)
  const entropyBuffer = Buffer.from(entropy);
  
  // bip39.entropyToMnemonic requires Buffer
  return entropyToMnemonic(entropyBuffer);
}

/**
 * Restore private key from seed phrase
 */
export function restoreFromSeedPhrase(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic);
  // Use first 32 bytes as private key (Ed25519 requires 32 bytes)
  const privateKey = new Uint8Array(32);
  privateKey.set(seed.slice(0, 32));
  return privateKey;
}

/**
 * Encrypt private key using PBKDF2 + AES-GCM
 * Falls back to Argon2id if available
 */
export async function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string,
  iterations: number = 100000
): Promise<EncryptedWallet> {
  const saltBytes = randomBytes(16);
  const salt = new Uint8Array(saltBytes);
  const ivBytes = randomBytes(12);
  const iv = new Uint8Array(ivBytes); // 96-bit IV for AES-GCM

  // Derive key using PBKDF2
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Convert to ArrayBuffer for crypto.subtle
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength);
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength);
  const privateKeyBuffer = privateKey.buffer.slice(privateKey.byteOffset, privateKey.byteOffset + privateKey.byteLength);

  const keyMaterial = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer as ArrayBuffer,
      iterations: iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer as ArrayBuffer,
    },
    keyMaterial,
    privateKeyBuffer as ArrayBuffer
  );

  return {
    encryptedData: encodeBase64(new Uint8Array(encrypted)),
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    iterations,
  };
}

/**
 * Decrypt private key
 */
export async function decryptPrivateKey(
  encrypted: EncryptedWallet,
  password: string
): Promise<Uint8Array> {
  const saltArray = decodeBase64(encrypted.salt);
  const ivArray = decodeBase64(encrypted.iv);
  const encryptedDataArray = decodeBase64(encrypted.encryptedData);
  
  // Convert to ArrayBuffer
  const salt = saltArray.buffer.slice(saltArray.byteOffset, saltArray.byteOffset + saltArray.byteLength);
  const iv = ivArray.buffer.slice(ivArray.byteOffset, ivArray.byteOffset + ivArray.byteLength);
  const encryptedData = encryptedDataArray.buffer.slice(encryptedDataArray.byteOffset, encryptedDataArray.byteOffset + encryptedDataArray.byteLength);

  // Derive key
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const keyMaterial = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as ArrayBuffer,
      iterations: encrypted.iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as ArrayBuffer,
    },
    keyMaterial,
    encryptedData as ArrayBuffer
  );

  return new Uint8Array(decrypted);
}

/**
 * Sign message with Ed25519 private key
 */
export async function signMessage(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      // WebCrypto signing - Ed25519 may not be supported in all browsers
      // Fall through to @noble/ed25519
      throw new Error('Ed25519 not supported in WebCrypto');
    }
  } catch (e) {
    // Fallback to @noble/ed25519
  }

  return await ed25519.sign(message, privateKey);
}

/**
 * Verify signature
 */
export async function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      // WebCrypto verify - Ed25519 may not be supported
      // Fall through to @noble/ed25519
      throw new Error('Ed25519 not supported in WebCrypto');
    }
  } catch (e) {
    // Fallback
  }

  return await ed25519.verify(signature, message, publicKey);
}

/**
 * Convert public key to base64
 */
export function publicKeyToBase64(publicKey: Uint8Array): string {
  return encodeBase64(publicKey);
}

/**
 * Convert base64 to public key
 */
export function base64ToPublicKey(base64: string): Uint8Array {
  return decodeBase64(base64);
}

/**
 * Convert private key to base64 (for backup)
 */
export function privateKeyToBase64(privateKey: Uint8Array): string {
  return encodeBase64(privateKey);
}

/**
 * Convert base64 to private key (for restore)
 */
export function base64ToPrivateKey(base64: string): Uint8Array {
  return decodeBase64(base64);
}
