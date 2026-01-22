/**
 * Wallet Service
 * Manages Ed25519 keypair, encryption, and session state
 */

import {
  generateKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  deriveSeedPhrase,
  restoreFromSeedPhrase,
  privateKeyToBase64,
  EncryptedWallet,
} from '@clob-exchange/crypto';
import * as ed25519 from '@noble/ed25519';

const WALLET_STORAGE_KEY = 'clob_wallet_encrypted';

export interface WalletState {
  publicKey: Uint8Array;
  privateKey: Uint8Array | null; // null when locked
  partyId: string | null;
  isUnlocked: boolean;
}

export class WalletService {
  private state: WalletState = {
    publicKey: new Uint8Array(),
    privateKey: null,
    partyId: null,
    isUnlocked: false,
  };

  /**
   * Generate new wallet
   */
  async generateWallet(): Promise<{ publicKey: Uint8Array; seedPhrase: string }> {
    const keyPair = await generateKeyPair();
    const seedPhrase = deriveSeedPhrase(keyPair.privateKey);

    // Store public key in session
    this.state.publicKey = keyPair.publicKey;
    this.state.privateKey = keyPair.privateKey;
    this.state.isUnlocked = true;

    return {
      publicKey: keyPair.publicKey,
      seedPhrase,
    };
  }

  /**
   * Encrypt and save wallet
   */
  async saveWallet(password: string): Promise<void> {
    if (!this.state.privateKey) {
      throw new Error('No private key to save');
    }

    const encrypted = await encryptPrivateKey(this.state.privateKey, password);

    // Store in IndexedDB or localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(encrypted));
      // Store publicKey separately so it's available even when wallet is locked
      if (this.state.publicKey.length > 0) {
        const publicKeyBase64 = Buffer.from(this.state.publicKey).toString('base64');
        localStorage.setItem('clob_wallet_public_key', publicKeyBase64);
      }
    }

    // Clear private key from memory (keep public key in state for Step 1)
    this.state.privateKey = null;
    this.state.isUnlocked = false;
    // NOTE: publicKey stays in state so Step 1 can work without unlock
  }

  /**
   * Unlock wallet with password
   */
  async unlockWallet(password: string): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Wallet service only works in browser');
    }

    const encryptedData = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!encryptedData) {
      throw new Error('No wallet found. Please create a new wallet.');
    }

    const encrypted: EncryptedWallet = JSON.parse(encryptedData);
    const privateKey = await decryptPrivateKey(encrypted, password);

    // Derive public key from private key (Ed25519 allows this)
    const publicKey = await ed25519.getPublicKey(privateKey);

    // Restore keypair
    this.state.privateKey = privateKey;
    this.state.publicKey = publicKey;
    this.state.isUnlocked = true;
  }

  /**
   * Restore wallet from seed phrase
   */
  async restoreFromSeedPhrase(mnemonic: string, password: string): Promise<void> {
    const privateKey = restoreFromSeedPhrase(mnemonic);
    
    // Derive public key from private key (Ed25519 allows this)
    const publicKey = await ed25519.getPublicKey(privateKey);
    
    this.state.privateKey = privateKey;
    this.state.publicKey = publicKey;
    this.state.isUnlocked = true;

    // Save encrypted
    await this.saveWallet(password);
  }

  /**
   * Lock wallet (clear private key from memory)
   */
  lockWallet(): void {
    this.state.privateKey = null;
    this.state.isUnlocked = false;
  }

  /**
   * Get current wallet state
   */
  getState(): WalletState {
    return { ...this.state };
  }

  /**
   * Set party ID after allocation
   */
  setPartyId(partyId: string): void {
    this.state.partyId = partyId;
  }

  /**
   * Get public key as base64
   * Works even when wallet is locked (publicKey is stored separately)
   */
  getPublicKeyBase64(): string {
    // First try to get from state (if wallet was unlocked or just created)
    if (this.state.publicKey.length > 0) {
      return Buffer.from(this.state.publicKey).toString('base64');
    }
    
    // If not in state, try to get from localStorage (stored when wallet was saved)
    if (typeof window !== 'undefined') {
      const storedPublicKey = localStorage.getItem('clob_wallet_public_key');
      if (storedPublicKey) {
        return storedPublicKey;
      }
    }
    
    throw new Error('Public key not available. Please unlock wallet to derive public key.');
  }

  /**
   * Get private key (only when unlocked)
   */
  getPrivateKey(): Uint8Array {
    if (!this.state.isUnlocked || !this.state.privateKey) {
      throw new Error('Wallet is locked');
    }
    return this.state.privateKey;
  }

  /**
   * Check if wallet exists
   */
  hasWallet(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(WALLET_STORAGE_KEY) !== null;
  }

  /**
   * Export private key as base64 (for backup)
   */
  exportPrivateKey(): string {
    if (!this.state.isUnlocked || !this.state.privateKey) {
      throw new Error('Wallet is locked');
    }
    return privateKeyToBase64(this.state.privateKey);
  }
}

// Singleton instance
export const walletService = new WalletService();
