/**
 * Wallet SDK Service
 * 
 * Uses the Canton Wallet SDK to handle Splice Token Standard operations
 * including accepting transfer instructions with proper disclosed contracts.
 */

const { WalletSDKImpl, createKeyPair } = require('@canton-network/wallet-sdk');
const constants = require('../config/constants');

class WalletSdkService {
  constructor() {
    this.sdk = null;
    this.initialized = false;
  }

  /**
   * Initialize the SDK with the Canton network configuration
   */
  async initialize() {
    if (this.initialized) return;

    try {
      console.log('[WalletSdkService] Initializing Canton Wallet SDK...');
      
      // Get the JSON API and other endpoints from constants
      const jsonApiUrl = constants.cantonJsonApi || 'http://65.108.40.104:31539';
      const scanProxyUrl = constants.scanProxyUrl || 'http://65.108.40.104:8088';
      
      // Create SDK instance with custom configuration for WolfEdge devnet
      this.sdk = new WalletSDKImpl().configure({
        logger: console,
        // Custom auth factory for WolfEdge Keycloak
        authFactory: async () => ({
          getAccessToken: async () => {
            // Get token from Keycloak
            const tokenUrl = 'https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token';
            const response = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: constants.keycloakClientId || 'Sesnp3u6udkFF983rfprvsBbx3X3mBpw',
                client_secret: constants.keycloakClientSecret || 'mEGBw5Td3OUSanQoGeNMWg2nnPxq1VYc',
                scope: 'daml_ledger_api',
              }),
            });
            const data = await response.json();
            return data.access_token;
          },
        }),
        // Custom ledger factory for WolfEdge JSON API
        ledgerFactory: () => ({
          url: jsonApiUrl + '/api/json-api',
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
