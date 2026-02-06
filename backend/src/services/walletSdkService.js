/**
 * Wallet SDK Service
 * 
 * Uses the Canton Wallet SDK to handle Splice Token Standard operations
 * including accepting transfer instructions with proper disclosed contracts.
 */

const constants = require('../config/constants');

// Lazy load SDK to avoid import errors if not installed
let WalletSDKImpl = null;
let sdkLoadError = null;

try {
  const walletSdk = require('@canton-network/wallet-sdk');
  WalletSDKImpl = walletSdk.WalletSDKImpl;
} catch (e) {
  sdkLoadError = e.message;
  console.log('[WalletSdkService] SDK package not available:', e.message);
}

class WalletSdkService {
  constructor() {
    this.sdk = null;
    this.initialized = false;
    this.initError = sdkLoadError;
  }

  /**
   * Initialize the SDK with the Canton network configuration
   */
  async initialize() {
    if (this.initialized) return;
    if (this.initError) return; // Already failed

    if (!WalletSDKImpl) {
      this.initError = 'SDK not loaded';
      return;
    }

    try {
      console.log('[WalletSdkService] Initializing Canton Wallet SDK...');
      
      // Get the JSON API and other endpoints from constants
      const jsonApiUrl = constants.cantonJsonApi || 'http://65.108.40.104:31539';
      const scanProxyUrl = constants.scanProxyUrl || 'http://65.108.40.104:8088';
      
      // Auth token from environment
      const adminToken = process.env.ADMIN_TOKEN || constants.adminToken;
      
      // Create SDK instance with custom configuration for WolfEdge devnet
      this.sdk = new WalletSDKImpl().configure({
        logger: console,
        // Auth factory that returns the proper interface
        authFactory: () => ({
          // Return an auth client that provides the token
          getUserToken: async () => adminToken,
          getAccessToken: async () => adminToken,
          loginSilent: async () => {},
          logout: async () => {},
        }),
        // Custom ledger factory for WolfEdge JSON API
        ledgerFactory: () => ({
          url: jsonApiUrl,
          headers: {
            'Authorization': `Bearer ${adminToken}`,
          },
        }),
        // Token standard factory for registry lookups
        tokenStandardFactory: () => ({
          registryUrl: scanProxyUrl,
        }),
      });

      await this.sdk.connect();
      console.log('[WalletSdkService] SDK connected successfully');
      
      this.initialized = true;
    } catch (error) {
      console.error('[WalletSdkService] Failed to initialize SDK:', error.message);
      this.initError = error.message;
      // Don't throw - allow fallback to direct API
    }
  }

  /**
   * Get pending transfer instructions for a party
   * @param {string} partyId - The party to check for pending transfers
   */
  async getPendingTransfers(partyId) {
    await this.initialize();
    
    if (!this.sdk || !this.sdk.tokenStandard) {
      console.log('[WalletSdkService] SDK not available, using fallback');
      return null;
    }

    try {
      await this.sdk.setPartyId(partyId);
      const pendingInstructions = await this.sdk.tokenStandard.fetchPendingTransferInstructionView();
      return pendingInstructions;
    } catch (error) {
      console.error('[WalletSdkService] Failed to get pending transfers:', error.message);
      return null;
    }
  }

  /**
   * Accept a transfer instruction using the SDK
   * This handles getting the disclosed contracts automatically
   * 
   * @param {string} contractId - The transfer instruction contract ID
   * @param {string} partyId - The receiving party
   * @param {string} privateKey - The party's private key (optional, for external parties)
   */
  async acceptTransfer(contractId, partyId, privateKey = null) {
    await this.initialize();
    
    if (!this.sdk || !this.sdk.tokenStandard) {
      console.log('[WalletSdkService] SDK not available');
      return { success: false, error: 'SDK not initialized' };
    }

    try {
      await this.sdk.setPartyId(partyId);
      
      // Get the accept command with disclosed contracts
      const [acceptCommand, disclosedContracts] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
        contractId,
        'Accept'
      );
      
      console.log('[WalletSdkService] Got accept command with', disclosedContracts?.length || 0, 'disclosed contracts');
      
      if (privateKey) {
        // If we have the private key, execute directly
        const { v4: uuidv4 } = require('uuid');
        const result = await this.sdk.userLedger?.prepareSignAndExecuteTransaction(
          acceptCommand,
          privateKey,
          uuidv4(),
          disclosedContracts
        );
        return { success: true, result, usedSdk: true };
      } else {
        // Return the command and disclosed contracts for external execution
        return {
          success: true,
          command: acceptCommand,
          disclosedContracts: disclosedContracts,
          usedSdk: true,
        };
      }
    } catch (error) {
      console.error('[WalletSdkService] Failed to accept transfer:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the choice context for accepting a transfer
   * Returns the disclosed contracts needed for the exercise command
   */
  async getAcceptChoiceContext(contractId, partyId) {
    await this.initialize();
    
    if (!this.sdk || !this.sdk.tokenStandard) {
      return null;
    }

    try {
      await this.sdk.setPartyId(partyId);
      
      const [command, disclosedContracts] = await this.sdk.tokenStandard.exerciseTransferInstructionChoice(
        contractId,
        'Accept'
      );
      
      return {
        command,
        disclosedContracts: disclosedContracts?.map(dc => ({
          templateId: dc.templateId,
          contractId: dc.contractId,
          createdEventBlob: dc.createdEventBlob,
        })),
      };
    } catch (error) {
      console.error('[WalletSdkService] Failed to get choice context:', error.message);
      return null;
    }
  }
}

// Singleton instance
const walletSdkService = new WalletSdkService();

module.exports = walletSdkService;
