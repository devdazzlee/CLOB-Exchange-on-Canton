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
   * Query for pending transfer offers (TransferInstruction contracts) for a party
   * Transfer offers can come from:
   * - Canton utilities faucet (CBTC, etc.)
   * - Other users sending tokens
   * 
   * In Splice Token Standard, transfers are 2-step:
   * 1. Sender creates a TransferInstruction (the "offer")
   * 2. Receiver exercises Accept choice on the TransferInstruction
   * 
   * @param {string} partyId - The party to check for offers
   * @param {string} token - Admin token for Canton API
   * @returns {Array} List of pending transfer offers
   */
  async getTransferOffers(partyId, token) {
    await this.initialize();
    
    try {
      console.log(`[TransferOfferService] Querying transfer offers (TransferInstructions) for: ${partyId.substring(0, 30)}...`);
      
      let allOffers = [];
      
      // Method 1: Query using Splice TransferInstruction Interface (# prefix)
      // This is the proper way to find all TransferInstruction contracts
      try {
        console.log(`[TransferOfferService] Trying InterfaceFilter for TransferInstruction...`);
        const spliceOffers = await this.cantonService.queryActiveContracts({
          party: partyId,
          interfaceIds: ['#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'],
        }, token);
        console.log(`[TransferOfferService] InterfaceFilter found ${spliceOffers.length} TransferInstructions`);
        allOffers.push(...spliceOffers);
      } catch (e) {
        console.log(`[TransferOfferService] InterfaceFilter query failed: ${e.message.substring(0, 100)}`);
      }
      
      // Method 2: Fallback - Query all contracts and filter
      if (allOffers.length === 0) {
        console.log(`[TransferOfferService] Fallback: querying all contracts...`);
        
        const allContracts = await this.cantonService.queryActiveContracts({
          party: partyId,
          templateIds: [],  // Wildcard - get all templates
        }, token);
        
        console.log(`[TransferOfferService] Found ${allContracts.length} total contracts`);
        
        // Filter for transfer-related contracts
        const transferContracts = allContracts.filter(contract => {
          const templateId = (contract.createdEvent?.templateId || contract.templateId || '').toLowerCase();
          const payload = contract.payload || {};
          
          // Check if template looks like a transfer offer/instruction
          const isTransferOffer = 
            templateId.includes('transfer') ||
            templateId.includes('instruction') ||
            templateId.includes('offer') ||
            payload.receiver === partyId ||
            payload.recipient === partyId;
            
          return isTransferOffer;
        });
        
        allOffers.push(...transferContracts);
      }
      
      console.log(`[TransferOfferService] Found ${allOffers.length} potential transfer offers`);
      
      // Map to a consistent format
      return allOffers.map(contract => {
        const payload = contract.payload || contract.interfaceView || {};
        const templateId = contract.createdEvent?.templateId || contract.templateId || '';
        
        // Handle nested transfer data structure (e.g., payload.transfer.amount)
        // Splice/Canton uses: { transfer: { sender, receiver, amount, instrumentId: { id: "CBTC" } } }
        const transferData = payload.transfer || {};
        
        // Extract token info - check nested structures first
        let tokenSymbol = transferData.instrumentId?.id ||
                          transferData.instrument?.id ||
                          payload.instrument?.id || 
                          payload.instrumentId?.id || 
                          payload.token || 
                          payload.asset ||
                          'Unknown';
        
        // Extract amount - check nested transfer data first
        let amount = transferData.amount || 
                     payload.amount || 
                     payload.quantity || 
                     '0';
        
        // Extract sender/receiver - check nested structure first
        let sender = transferData.sender || 
                     payload.sender || 
                     payload.provider || 
                     payload.from || 
                     'unknown';
        
        let receiver = transferData.receiver || 
                       payload.receiver || 
                       payload.recipient || 
                       payload.to || 
                       partyId;
        
        return {
          contractId: contract.contractId,
          templateId: templateId,
          payload: payload,
          sender: sender,
          receiver: receiver,
          amount: amount,
          token: tokenSymbol,
          isSplice: templateId.toLowerCase().includes('splice') || !!contract.interfaceView,
        };
      });
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to get transfer offers:', error.message);
      throw error;
    }
  }

  /**
   * Accept a transfer offer (Splice Token Standard TransferInstruction)
   * This creates a new Holding for the receiving party
   * 
   * Supports:
   * - Splice Token Standard TransferInstruction: Accept choice
   * - Custom templates with Accept/AcceptTransfer choices
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
      console.log(`[TransferOfferService] Accepting transfer offer: ${offerContractId.substring(0, 30)}...`);
      
      let offerTemplateId = templateId;
      let isSplice = false;
      
      // If template ID not provided, fetch the offer to discover it
      if (!offerTemplateId) {
        // Try InterfaceFilter first (for Splice)
        try {
          const spliceOffers = await this.cantonService.queryActiveContracts({
            party: partyId,
            interfaceIds: ['#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'],
          }, token);
          
          const offer = spliceOffers.find(c => c.contractId === offerContractId);
          if (offer) {
            offerTemplateId = offer.createdEvent?.templateId || offer.templateId;
            isSplice = true;
            console.log(`[TransferOfferService] Found Splice TransferInstruction: ${offerTemplateId}`);
          }
        } catch (e) {
          console.log(`[TransferOfferService] Splice interface query failed, trying fallback...`);
        }
        
        // Fallback: Query all contracts
        if (!offerTemplateId) {
          const contracts = await this.cantonService.queryActiveContracts({
            party: partyId,
            templateIds: [],
          }, token);
          
          const offer = contracts.find(c => c.contractId === offerContractId);
          
          if (!offer) {
            throw new Error(`Transfer offer not found: ${offerContractId}`);
          }
          
          offerTemplateId = offer.createdEvent?.templateId || offer.templateId;
          isSplice = offerTemplateId?.toLowerCase().includes('splice');
        }
      }
      
      console.log(`[TransferOfferService] Offer template: ${offerTemplateId} (Splice: ${isSplice})`);
      
      // Determine the accept choice name based on template
      // Splice Token Standard TransferInstruction uses "Accept" choice
      const acceptChoiceNames = [
        'Accept',  // Splice standard
        'TransferInstruction_Accept',  // Alternative
        'TransferOffer_Accept', 
        'AcceptTransfer',
        'Accept_TransferOffer',
      ];
      
      let result = null;
      let lastError = null;
      
      for (const choiceName of acceptChoiceNames) {
        try {
          console.log(`[TransferOfferService] Trying choice: ${choiceName}`);
          
          // For Splice TransferInstruction, only the receiver needs to authorize
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
          const errorMsg = e.message?.toLowerCase() || '';
          if (errorMsg.includes('unknown choice') || 
              errorMsg.includes('no such choice') ||
              errorMsg.includes('choice not found') ||
              errorMsg.includes('cnedchoice')) {
            console.log(`[TransferOfferService] Choice ${choiceName} not found, trying next...`);
            continue; // Try next choice name
          }
          // Other errors (like authorization) - log but continue trying
          console.log(`[TransferOfferService] Choice ${choiceName} failed: ${e.message.substring(0, 100)}`);
          continue;
        }
      }
      
      if (!result) {
        throw new Error(`Could not accept transfer offer. Last error: ${lastError?.message || 'No valid accept choice found'}`);
      }
      
      return {
        success: true,
        offerContractId,
        templateId: offerTemplateId,
        isSplice,
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
