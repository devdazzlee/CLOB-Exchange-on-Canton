/**
 * Onboarding Service (Frontend)
 * Handles external party allocation and preapproval creation
 * 
 * Correct 2-step flow:
 * 1) Step 1: Generate topology -> get multiHash + onboardingTransactions
 * 2) Sign multiHash client-side
 * 3) Step 2: Allocate with signature -> get partyId
 * 4) Ensure rights & create preapproval (only after partyId exists)
 */

import axios from 'axios';
import { Buffer } from 'buffer';
import { walletService } from './wallet';
import { signMessage } from '@clob-exchange/crypto';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export interface AllocatePartyResponse {
  step: 'TOPOLOGY' | 'ALLOCATED';
  partyId?: string; // May be present in Step 1 (if Canton provides it), always in Step 2
  partyHint: string;
  synchronizerId: string;
  multiHash?: string; // Only present in Step 1
  onboardingTransactions?: string[]; // Only present in Step 1 (alias for backward compatibility)
  topologyTransactions?: string[]; // Only present in Step 1 (Canton's actual field name)
}

export class OnboardingService {
  private isOnboardingBusy = false; // Guard to prevent duplicate Step1 calls
  private isCompletingOnboarding = false; // Guard to prevent duplicate completeOnboarding calls

  /**
   * Step 1: Generate topology for external party
   * Returns multiHash and onboardingTransactions for signing
   * 
   * IMPORTANT: Step 1 only needs publicKey - wallet does NOT need to be unlocked
   * Only Step 2 (signing) requires wallet unlock
   */
  async generateTopology(partyHint?: string): Promise<{
    partyHint: string;
    synchronizerId: string;
    multiHash: string;
    onboardingTransactions: string[];
    partyId?: string;
  }> {
    // Prevent duplicate calls
    if (this.isOnboardingBusy) {
      throw new Error('Onboarding is already in progress. Please wait.');
    }

    // Step 1 only needs publicKey - wallet can be locked
    // Check if wallet exists
    if (!walletService.hasWallet()) {
      throw new Error('Wallet not created. Please create wallet first.');
    }

    // Get publicKey (works even when wallet is locked - stored separately)
    let publicKeyBase64: string;
    try {
      publicKeyBase64 = walletService.getPublicKeyBase64();
    } catch (error: any) {
      throw new Error(`Public key not available: ${error.message}. Please unlock wallet to derive public key.`);
    }

    this.isOnboardingBusy = true;
    try {

      console.log('[Onboarding] Step 1: Generating topology...');
      const response = await axios.post<AllocatePartyResponse>(
        `${API_BASE_URL}/onboarding/allocate-party`,
        {
          publicKey: publicKeyBase64,
          partyHint,
        }
      );

      if (response.data.step !== 'TOPOLOGY') {
        throw new Error(`Expected step 'TOPOLOGY', got '${response.data.step}'`);
      }

      if (!response.data.multiHash) {
        throw new Error('Step 1 response missing multiHash');
      }

      // Accept both topologyTransactions (Canton's field) and onboardingTransactions (alias)
      const transactions = 
        response.data.topologyTransactions || 
        response.data.onboardingTransactions || 
        [];

      if (!transactions || transactions.length === 0) {
        throw new Error('Step 1 response missing topologyTransactions or onboardingTransactions (or it is empty)');
      }

      console.log(`[Onboarding] Step 1 complete. Transactions count: ${transactions.length}`);

      return {
        partyHint: response.data.partyHint,
        synchronizerId: response.data.synchronizerId,
        multiHash: response.data.multiHash,
        onboardingTransactions: transactions, // Normalize to onboardingTransactions for consistency
        partyId: response.data.partyId, // Optional, if Canton provided it
      };
    } finally {
      this.isOnboardingBusy = false;
    }
  }

  /**
   * Step 2: Allocate external party with signature
   * Signs the multiHash from Step 1 and completes allocation
   */
  async allocateWithSignature(
    partyHint: string,
    multiHash: string,
    onboardingTransactions: string[],
    partyId?: string // Optional: partyId from Step 1 if Canton provided it
  ): Promise<string> {
    const publicKeyBase64 = walletService.getPublicKeyBase64();
    let privateKey: Uint8Array;
    try {
      privateKey = walletService.getPrivateKey();
    } catch (error) {
      throw new Error('Private key not available. Please unlock wallet first.');
    }

    // Sign the multiHash
    const multiHashBytes = Buffer.from(multiHash, 'base64');
    const signature = await signMessage(multiHashBytes, privateKey);
    const signatureBase64 = Buffer.from(signature).toString('base64');

    // Allocate with signature
    // Send both onboardingTransactions (alias) and topologyTransactions (Canton's field)
    // Backend accepts either, but we send both for compatibility
    const response = await axios.post<AllocatePartyResponse>(
      `${API_BASE_URL}/onboarding/allocate-party`,
      {
        publicKey: publicKeyBase64,
        partyHint,
        signature: signatureBase64,
        onboardingTransactions, // Alias
        topologyTransactions: onboardingTransactions, // Canton's actual field name
        ...(partyId && { partyId }), // Include partyId if provided from Step 1
      }
    );

    if (response.data.step !== 'ALLOCATED') {
      throw new Error(`Expected step 'ALLOCATED', got '${response.data.step}'`);
    }

    if (!response.data.partyId) {
      throw new Error('Step 2 response missing partyId');
    }

    const allocatedPartyId = response.data.partyId;
    walletService.setPartyId(allocatedPartyId);

    return allocatedPartyId;
  }

  /**
   * Create transfer preapproval (idempotent)
   * Only call this AFTER partyId exists (after Step 2)
   */
  async createTransferPreapproval(partyId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/onboarding/create-preapproval`, {
      partyId: partyId,
    });
  }

  /**
   * Ensure user rights (idempotent check)
   * Only call this AFTER partyId exists (after Step 2)
   */
  async ensureUserRights(partyId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/onboarding/ensure-rights`, {
      partyId: partyId,
    });
  }

  /**
   * Complete full onboarding flow (2-step)
   * 
   * Step 1: Generate topology
   * Step 2: Sign and allocate (requires unlocked wallet)
   * Step 3: Ensure rights & create preapproval
   * 
   * IMPORTANT: Wallet must be unlocked before calling this method
   */
  async completeOnboarding(partyHint?: string): Promise<string> {
    // Prevent duplicate calls
    if (this.isCompletingOnboarding) {
      console.log('[Onboarding] completeOnboarding already in progress, skipping duplicate call');
      throw new Error('Onboarding is already in progress. Please wait.');
    }

    // Check if partyId already exists
    const walletState = walletService.getState();
    if (walletState.partyId) {
      console.log('[Onboarding] Party ID already exists, skipping onboarding:', walletState.partyId);
      return walletState.partyId;
    }

    this.isCompletingOnboarding = true;
    try {
      // Verify wallet is unlocked before starting
      if (!walletState.isUnlocked) {
        throw new Error('Wallet is locked. Please unlock wallet before completing onboarding.');
      }

      // Verify we have a private key
      try {
        walletService.getPrivateKey();
      } catch (error: any) {
        throw new Error(`Private key not available: ${error.message}. Please unlock wallet first.`);
      }

      console.log('[Onboarding] Starting complete onboarding flow...');
      console.log(`[Onboarding] Public key: ${walletService.getPublicKeyBase64().substring(0, 20)}...`);

      // Step 1: Generate topology
      console.log('[Onboarding] Step 1: Generating topology...');
      const step1Response = await this.generateTopology(partyHint);
      
      if (!step1Response.onboardingTransactions || step1Response.onboardingTransactions.length === 0) {
        throw new Error('Step 1 response missing onboardingTransactions');
      }

      console.log(`[Onboarding] Step 1 complete. onboardingTransactions count: ${step1Response.onboardingTransactions.length}`);

      // Step 2: Sign and allocate (wallet is already verified as unlocked)
      console.log('[Onboarding] Step 2: Signing and allocating...');
      const partyId = await this.allocateWithSignature(
        step1Response.partyHint,
        step1Response.multiHash,
        step1Response.onboardingTransactions,
        step1Response.partyId // Pass partyId from Step 1 if Canton provided it
      );

      // Step 3: Ensure rights & create preapproval (only after partyId exists)
      console.log('[Onboarding] Step 3: Ensuring rights and creating preapproval...');
      try {
        await this.ensureUserRights(partyId);
      } catch (error) {
        console.warn('Failed to ensure rights (non-blocking):', error);
      }

      try {
        await this.createTransferPreapproval(partyId);
      } catch (error) {
        console.warn('Failed to create preapproval (non-blocking):', error);
      }

      console.log(`[Onboarding] Complete onboarding flow finished. Party ID: ${partyId}`);
      return partyId;
    } finally {
      this.isCompletingOnboarding = false;
    }
  }

  /**
   * Legacy method for backwards compatibility
   * @deprecated Use completeOnboarding() instead
   */
  async allocateExternalParty(partyHint?: string): Promise<string> {
    return this.completeOnboarding(partyHint);
  }
}

export const onboardingService = new OnboardingService();
