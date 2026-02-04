/**
 * Transfer Offer Service - Handle Canton/Splice Token Transfers
 * 
 * This service handles accepting transfer offers from external sources
 * like the Canton DevNet faucet (CBTC, etc.)
 * 
 * The client mentioned:
 * - Use utilities UI: https://utilities.dev.canton.wolfedgelabs.com/
 * - Navigate to: registry -> transfers
 * - Accept transfer-offers of tokens like CBTC
 */

const config = require('../config');
const { getTokenStandardTemplateIds, OPERATOR_PARTY_ID } = require('../config/constants');
const tokenProvider = require('./tokenProvider');

// Get canton service instance
let cantonServiceInstance = null;
const getCantonService = () => {
  if (!cantonServiceInstance) {
    cantonServiceInstance = require('./cantonService');
  }
  return cantonServiceInstance;
};

class TransferOfferService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    this.cantonService = getCantonService();
    this.initialized = true;
    console.log('[TransferOfferService] Initialized');
  }

  /**
   * Query for pending transfer offers for a party
   * Transfer offers can come from:
   * - Canton utilities faucet (CBTC, etc.)
   * - Other users sending tokens
   * 
   * @param {string} partyId - The party to check for offers
   * @param {string} token - Admin token for Canton API
   * @returns {Array} List of pending transfer offers
   */
  async getTransferOffers(partyId, token) {
    await this.initialize();
    
    try {
      console.log(`[TransferOfferService] Querying transfer offers for: ${partyId.substring(0, 30)}...`);
      
      // Query for any contracts where this party is an observer or receiver
      // The Splice/Canton token standard uses different offer templates
      const possibleTemplates = [
        // Splice Token Standard templates (these may vary by deployment)
        'Splice.TokenStandard:TransferOffer:TransferOffer',
        'Splice.TokenStandard.Fungible:TransferOffer:TransferOffer',
        'Splice.Wallet:TransferOffer:TransferOffer',
        // Try with wildcards via separate query
      ];
      
      // First, get all contracts visible to this party
      const allContracts = await this.cantonService.queryActiveContracts({
        party: partyId,
        templateIds: [],  // Wildcard - get all templates
      }, token);
      
      console.log(`[TransferOfferService] Found ${allContracts.length} total contracts`);
      
      // Filter for anything that looks like a transfer offer
      const transferOffers = allContracts.filter(contract => {
        const templateId = contract.createdEvent?.templateId || '';
        const payload = contract.payload || {};
        
        // Check if template looks like a transfer offer
        const isTransferOffer = 
          templateId.toLowerCase().includes('transfer') ||
          templateId.toLowerCase().includes('offer') ||
          payload.receiver === partyId ||
          payload.recipient === partyId;
          
        return isTransferOffer;
      });
      
      console.log(`[TransferOfferService] Found ${transferOffers.length} potential transfer offers`);
      
      return transferOffers.map(contract => ({
        contractId: contract.contractId,
        templateId: contract.createdEvent?.templateId,
        payload: contract.payload,
        sender: contract.payload?.sender || contract.payload?.provider || 'unknown',
        receiver: contract.payload?.receiver || contract.payload?.recipient || partyId,
        amount: contract.payload?.amount || contract.payload?.quantity,
        token: contract.payload?.token || contract.payload?.instrumentId?.symbol,
      }));
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to get transfer offers:', error.message);
      throw error;
    }
  }

  /**
   * Accept a transfer offer (Splice Token Standard)
   * This creates a new Holding for the receiving party
   * 
   * Supports both:
   * - Splice Token Standard: splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:TransferOffer
   * - Custom templates: Our own TransferOffer templates
   * 
   * @param {string} offerContractId - The transfer offer contract ID
   * @param {string} partyId - The party accepting the offer
   * @param {string} token - Admin token
   * @param {string} templateId - Optional template ID (if known, speeds up acceptance)
   * @returns {Object} Result of accepting the offer
   */
  async acceptTransferOffer(offerContractId, partyId, token, templateId = null) {
    await this.initialize();
    
    try {
      console.log(`[TransferOfferService] Accepting transfer offer: ${offerContractId.substring(0, 20)}...`);
      
      let offerTemplateId = templateId;
      
      // If template ID not provided, fetch the offer to discover it
      if (!offerTemplateId) {
        const contracts = await this.cantonService.queryActiveContracts({
          party: partyId,
          templateIds: [],
        }, token);
        
        const offer = contracts.find(c => c.contractId === offerContractId);
        
        if (!offer) {
          throw new Error(`Transfer offer not found: ${offerContractId}`);
        }
        
        offerTemplateId = offer.createdEvent?.templateId;
      }
      
      console.log(`[TransferOfferService] Offer template: ${offerTemplateId}`);
      
      // Determine the accept choice name based on template
      // Splice Token Standard uses different choice names
      const acceptChoiceNames = [
        'Accept',  // Most common
        'TransferOffer_Accept', 
        'AcceptTransfer',
        'Accept_TransferOffer',
        'Splice.Api.Token.HoldingV1.TransferOffer_Accept', // Splice full path
      ];
      
      let result = null;
      let lastError = null;
      
      for (const choiceName of acceptChoiceNames) {
        try {
          console.log(`[TransferOfferService] Trying choice: ${choiceName}`);
          
          // For Splice, only the receiver needs to authorize
          result = await this.cantonService.exerciseChoice({
            token,
            templateId: offerTemplateId,
            contractId: offerContractId,
            choice: choiceName,
            choiceArgument: {},
            actAsParty: [partyId], // Only receiver needs to authorize
          });
          
          console.log(`[TransferOfferService] ✅ Accepted with choice: ${choiceName}`);
          break;
        } catch (e) {
          lastError = e;
          if (e.message.includes('unknown choice') || 
              e.message.includes('No such choice') ||
              e.message.includes('choice not found')) {
            console.log(`[TransferOfferService] Choice ${choiceName} not found, trying next...`);
            continue; // Try next choice name
          }
          // Other errors (like authorization) should be thrown
          throw e;
        }
      }
      
      if (!result) {
        throw new Error(`Could not find valid accept choice. Last error: ${lastError?.message || 'unknown'}`);
      }
      
      return {
        success: true,
        offerContractId,
        templateId: offerTemplateId,
        result,
      };
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to accept transfer offer:', error.message);
      throw error;
    }
  }

  /**
   * List all external tokens (from Splice/Canton infrastructure)
   * These are tokens not created by our CLOB but available on the network
   * 
   * @param {string} token - Admin token
   * @returns {Array} List of known external token types
   */
  async listExternalTokens(token) {
    await this.initialize();
    
    try {
      // Query for Instrument contracts on the network
      // This will find both our instruments and external ones
      const templateIds = getTokenStandardTemplateIds();
      
      const instruments = await this.cantonService.queryActiveContracts({
        party: OPERATOR_PARTY_ID,
        templateIds: [templateIds.instrument],
      }, token);
      
      // Also try to find Splice-native instruments
      // These might be under different package IDs
      
      const uniqueInstruments = new Map();
      
      for (const contract of instruments) {
        const payload = contract.payload;
        const key = `${payload.instrumentId?.symbol || payload.symbol}`;
        
        if (!uniqueInstruments.has(key)) {
          uniqueInstruments.set(key, {
            symbol: payload.instrumentId?.symbol || payload.symbol,
            issuer: payload.instrumentId?.issuer || payload.issuer,
            decimals: payload.decimals,
            contractId: contract.contractId,
            templateId: contract.createdEvent?.templateId,
          });
        }
      }
      
      return Array.from(uniqueInstruments.values());
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to list external tokens:', error.message);
      throw error;
    }
  }
}

// Singleton
let transferOfferServiceInstance = null;

function getTransferOfferService() {
  if (!transferOfferServiceInstance) {
    transferOfferServiceInstance = new TransferOfferService();
  }
  return transferOfferServiceInstance;
}

module.exports = {
  TransferOfferService,
  getTransferOfferService,
};
