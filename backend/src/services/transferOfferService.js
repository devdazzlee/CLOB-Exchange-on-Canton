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
const { getTokenStandardTemplateIds, OPERATOR_PARTY_ID, DSO_PARTY_ID, REGISTRY_BACKEND_API, SCAN_PROXY_API, VALIDATOR_SCAN_PROXY_API, TEMPLATE_IDS } = require('../config/constants');
const { UTILITIES_CONFIG } = require('../config/canton-sdk.config');
const tokenProvider = require('./tokenProvider');

// Get canton service instance
let cantonServiceInstance = null;
const getCantonService = () => {
  if (!cantonServiceInstance) {
    cantonServiceInstance = require('./cantonService');
  }
  return cantonServiceInstance;
};

// Canton SDK client (primary for all transfers)
let sdkClientInstance = null;
const getSDKClient = () => {
  if (!sdkClientInstance) {
    try {
      const { getCantonSDKClient } = require('./canton-sdk-client');
      sdkClientInstance = getCantonSDKClient();
    } catch (e) {
      console.log('[TransferOfferService] Canton SDK client not available:', e.message);
    }
  }
  return sdkClientInstance;
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
        console.log(`[TransferOfferService] InterfaceFilter query failed: ${(e?.message || String(e)).substring(0, 100)}`);
      }
      
      // Method 2: Fallback - Query all contracts and filter
      if (allOffers.length === 0) {
        console.log(`[TransferOfferService] Fallback: querying all contracts...`);
        
        const allContracts = await this.cantonService.queryActiveContracts({
          party: partyId,
          templateIds: [],  // Wildcard - get all templates
        }, token);
        
        console.log(`[TransferOfferService] Found ${allContracts.length} total contracts`);
        
        // Filter for PENDING transfer offers/instructions only
        // Exclude already-executed/completed transfers (e.g., ExecutedTransfer, CompletedTransfer)
        const transferContracts = allContracts.filter(contract => {
          const templateId = (contract.createdEvent?.templateId || contract.templateId || '').toLowerCase();
          const payload = contract.payload || {};
          
          // Exclude completed/executed transfer artifacts
          if (templateId.includes('executedtransfer') || 
              templateId.includes('completedtransfer') ||
              templateId.includes('archivedtransfer')) {
            return false;
          }
          
          // Include only actual pending transfer instructions/offers
          const isPendingTransfer = 
            templateId.includes('transferinstruction') ||
            templateId.includes('transferoffer') ||
            templateId.includes('transfer_instruction') ||
            templateId.includes('transfer_offer') ||
            (templateId.includes('instruction') && templateId.includes('transfer'));
            
          return isPendingTransfer;
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
   * STEP 1: Prepare transfer accept for interactive signing (external parties)
   * 
   * External parties with Confirmation permission require interactive submission:
   * 1. Backend PREPARES the transaction → returns hash to sign
   * 2. Frontend SIGNS the hash with user's Ed25519 private key
   * 3. Backend EXECUTES with the user's signature
   * 
   * @param {string} offerContractId - The transfer offer contract ID
   * @param {string} partyId - The external party accepting the offer
   * @param {string} token - Admin/service token
   * @param {string} templateId - Optional template ID hint
   * @returns {Object} { preparedTransaction, preparedTransactionHash, choiceContextData, ... }
   */
  async prepareTransferAccept(offerContractId, partyId, token, templateId = null) {
    await this.initialize();
    
    const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
    
    try {
      console.log(`[TransferOfferService] PREPARE transfer accept: ${offerContractId.substring(0, 30)}... for ${partyId.substring(0, 30)}...`);
      
      const operatorPartyId = config.canton.operatorPartyId;
      const synchronizerId = config.canton.synchronizerId;
      const adminToken = token || await tokenProvider.getServiceToken();
      
      // ─── Interactive submission: actAs must ONLY contain the external party ────
      // In Canton's interactive submission flow, ALL actAs parties must provide
      // external signatures. The operator is an internal party (participant-hosted)
      // so it CANNOT provide an external signature.
      //
      // The operator's authorization comes from being a signatory on the
      // TransferInstruction contract — it doesn't need to be in actAs.
      // The TransferInstruction_Accept choice is controlled by the receiver only.
      //
      // readAs includes both parties so the command can read operator-visible contracts.
      const actAsParties = [partyId];  // Only the external party (signer)
      const readAsParties = [partyId];
      if (operatorPartyId && operatorPartyId !== partyId) {
        readAsParties.push(operatorPartyId);
      }
      
      console.log(`[TransferOfferService] actAs: [${actAsParties.map(p => p.substring(0, 30) + '...').join(', ')}]`);
      console.log(`[TransferOfferService] readAs: [${readAsParties.map(p => p.substring(0, 30) + '...').join(', ')}]`);
      
      // ─── Get choice context (disclosed contracts) ──────────────────────────────
      const { disclosedContracts, choiceContextData } = await this._getAcceptChoiceContext(
        offerContractId, adminToken, synchronizerId
      );
      
      const utilitiesInterface = UTILITIES_CONFIG.TRANSFER_INSTRUCTION_INTERFACE || TRANSFER_INSTRUCTION_INTERFACE;
      
      // ─── Prepare interactive submission ─────────────────────────────────────────
      console.log(`[TransferOfferService] Preparing interactive submission for external party...`);
      
      const prepareResult = await this.cantonService.prepareInteractiveSubmission({
        token: adminToken,
        actAsParty: actAsParties,
        templateId: utilitiesInterface,
        contractId: offerContractId,
        choice: 'TransferInstruction_Accept',
        choiceArgument: {
          extraArgs: {
            context: choiceContextData,
            meta: { values: {} },
          },
        },
        readAs: readAsParties,
        disclosedContracts,
        synchronizerId,
        verboseHashing: false
      });
      
      if (!prepareResult.preparedTransaction || !prepareResult.preparedTransactionHash) {
        throw new Error('Prepare returned incomplete result: missing preparedTransaction or preparedTransactionHash');
      }
      
      console.log(`[TransferOfferService] ✅ Transaction prepared. Hash to sign: ${prepareResult.preparedTransactionHash.substring(0, 40)}...`);
      
      return {
        success: true,
        step: 'PREPARED',
        preparedTransaction: prepareResult.preparedTransaction,
        preparedTransactionHash: prepareResult.preparedTransactionHash,
        hashingSchemeVersion: prepareResult.hashingSchemeVersion,
        hashingDetails: prepareResult.hashingDetails || null,
        offerContractId,
        partyId,
        actAsParties,
      };
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to prepare transfer accept:', error.message);
      throw error;
    }
  }

  /**
   * STEP 2: Execute prepared transfer accept with user's signature
   * 
   * @param {string} preparedTransaction - Opaque blob from prepare step
   * @param {string} partyId - The external party that signed the hash
   * @param {string} signatureBase64 - User's Ed25519 signature of preparedTransactionHash
   * @param {string} signedBy - Public key fingerprint that signed
   * @param {string} token - Admin/service token
   * @param {string|number} hashingSchemeVersion - From prepare response
   * @returns {Object} Transaction result
   */
  async executeTransferAccept(preparedTransaction, partyId, signatureBase64, signedBy, token, hashingSchemeVersion = 1) {
    await this.initialize();
    
    try {
      console.log(`[TransferOfferService] EXECUTE transfer accept for ${partyId.substring(0, 30)}...`);
      
      const adminToken = token || await tokenProvider.getServiceToken();
      
      // Build partySignatures in Canton's FLAT format:
      // partySignatures.signatures is an ARRAY of { party, signatures: [...] }
      const partySignatures = {
        signatures: [
          {
            party: partyId,
            signatures: [{
              format: 'SIGNATURE_FORMAT_RAW',
              signature: signatureBase64,
              signedBy: signedBy,
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519'
            }]
          }
        ]
      };
      
      console.log(`[TransferOfferService] Executing with signature from party: ${partyId.substring(0, 30)}...`);
      
      const result = await this.cantonService.executeInteractiveSubmission({
        preparedTransaction,
        partySignatures,
        hashingSchemeVersion,
      }, adminToken);
      
      console.log('[TransferOfferService] ✅ Transfer accepted via interactive submission!');
      return { success: true, usedInteractiveSubmission: true, result };
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to execute transfer accept:', error.message);
      throw error;
    }
  }

  /**
   * Helper: Get accept choice context (disclosed contracts + choice context data)
   * Tries multiple URL patterns for the Registry/Utilities Backend API
   */
  async _getAcceptChoiceContext(offerContractId, adminToken, synchronizerId) {
    const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
    const adminParty = UTILITIES_CONFIG.CBTC_ADMIN_PARTY;
    const encodedCid = encodeURIComponent(offerContractId);
    const scanProxyBase = SCAN_PROXY_API || 'http://65.108.40.104:8088';
    
    const urlPatterns = [
      `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
      `${backendUrl}/v0/registrars/${adminParty}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
      `${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
    ];
    
    for (const acceptContextUrl of urlPatterns) {
      try {
        console.log(`[TransferOfferService] Getting choice context: ${acceptContextUrl.substring(0, 120)}...`);
        
        const contextResponse = await fetch(acceptContextUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
        });
        
        if (contextResponse.ok) {
          const acceptContext = await contextResponse.json();
          console.log(`[TransferOfferService] ✅ Got accept context (${acceptContext.disclosedContracts?.length || 0} disclosed contracts)`);
          
          const disclosedContracts = (acceptContext.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || synchronizerId,
          }));
          
          const choiceContextData = acceptContext.choiceContextData || acceptContext.choiceContext?.choiceContextData || { values: {} };
          
          return { disclosedContracts, choiceContextData };
        } else {
          const errorText = await contextResponse.text();
          console.log(`[TransferOfferService] ${contextResponse.status}: ${errorText.substring(0, 150)}`);
        }
      } catch (err) {
        console.log(`[TransferOfferService] Failed: ${(err?.message || String(err)).substring(0, 120)}`);
      }
    }
    
    throw new Error(
      'Could not get accept choice context. The transfer offer may have expired or the registry is unavailable.'
    );
  }

  /**
   * Accept a transfer offer (legacy single-step for internal parties OR 2-step interactive for external)
   * 
   * For EXTERNAL parties: Uses interactive submission (prepare → sign → execute)
   * For INTERNAL parties: Uses direct exerciseChoice (deprecated path)
   * 
   * This method now defaults to interactive submission flow.
   * 
   * @param {string} offerContractId - The transfer offer contract ID
   * @param {string} partyId - The party accepting the offer
   * @param {string} token - Admin token
   * @param {string} templateId - Optional template ID (if known)
   * @returns {Object} For external parties: { requiresSignature, preparedTransaction, ... }
   */
  async acceptTransferOffer(offerContractId, partyId, token, templateId = null) {
    await this.initialize();
    
    const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
    
    try {
      console.log(`[TransferOfferService] Accepting transfer: ${offerContractId.substring(0, 30)}... for ${partyId.substring(0, 30)}...`);
      if (templateId) {
        console.log(`[TransferOfferService] Template hint: ${templateId.substring(0, 60)}...`);
      }
      
      const operatorPartyId = config.canton.operatorPartyId;
      const synchronizerId = config.canton.synchronizerId;
      
      // ─── External party detection ─────────────────────────────────────────────
      // External parties (with Confirmation permission) require interactive submission.
      // They typically start with "ext-" prefix (from onboarding-service.js generatePartyHint).
      const isExternalParty = partyId.startsWith('ext-');
      
      if (isExternalParty) {
        console.log(`[TransferOfferService] External party detected — using interactive submission (2-step flow)`);
        console.log(`[TransferOfferService] Frontend must call /prepare-accept then /execute-accept with user signature`);
        
        // Return a marker telling the caller (route handler) that interactive submission is needed
        // The route handler should respond with requiresSignature: true
        const prepareResult = await this.prepareTransferAccept(offerContractId, partyId, token, templateId);
        return {
          ...prepareResult,
          requiresSignature: true,
        };
      }
      
      // ─── Internal party path (legacy) ─────────────────────────────────────────
      // For internal parties, the participant signs for ALL actAs parties automatically.
      // So we include both the user and the operator in actAs.
      console.log(`[TransferOfferService] Internal party — using direct exerciseChoice`);
      
      const actAsParties = [partyId];
      if (operatorPartyId && operatorPartyId !== partyId) {
        actAsParties.push(operatorPartyId);
      }
      console.log(`[TransferOfferService] actAs parties: [${actAsParties.map(p => p.substring(0, 30) + '...').join(', ')}]`);
      
      const adminToken = token || await tokenProvider.getServiceToken();
      
      // Try SDK first
      const sdkClient = getSDKClient();
      if (sdkClient && sdkClient.isReady()) {
        try {
          let detectedSymbol = null;
          const templateLower = (templateId || '').toLowerCase();
          if (templateLower.includes('utility') || templateLower.includes('cbtc')) detectedSymbol = 'CBTC';
          else if (templateLower.includes('amulet')) detectedSymbol = 'CC';
          
          const result = await sdkClient.acceptTransfer(offerContractId, partyId, detectedSymbol);
          console.log('[TransferOfferService] ✅ Transfer accepted via Canton SDK!');
          return { success: true, offerContractId, usedSdk: true, result };
        } catch (sdkError) {
          console.log(`[TransferOfferService] SDK failed: ${(sdkError?.message || String(sdkError)).substring(0, 120)}`);
        }
      }
      
      // Try direct exerciseChoice via choice context
      try {
        const { disclosedContracts, choiceContextData } = await this._getAcceptChoiceContext(
          offerContractId, adminToken, synchronizerId
        );
        
              const utilitiesInterface = UTILITIES_CONFIG.TRANSFER_INSTRUCTION_INTERFACE || TRANSFER_INSTRUCTION_INTERFACE;
              
              const result = await this.cantonService.exerciseChoice({
                token: adminToken,
                templateId: utilitiesInterface,
                contractId: offerContractId,
                choice: 'TransferInstruction_Accept',
                choiceArgument: {
                  extraArgs: {
                    context: choiceContextData,
                    meta: { values: {} },
                  },
                },
                actAsParty: actAsParties,
                readAs: actAsParties,
                disclosedContracts,
                synchronizerId,
              });
              
        console.log('[TransferOfferService] ✅ Transfer accepted via direct exerciseChoice!');
        return { success: true, offerContractId, usedDirectExercise: true, result };
      } catch (directError) {
        console.log(`[TransferOfferService] Direct exercise failed: ${(directError?.message || String(directError)).substring(0, 120)}`);
      }
      
      // ─── All approaches failed ──────────────────────────────────────────────────
      throw new Error(
        'Transfer accept failed. The transfer offer may have expired, already been accepted, or the contract ID may be invalid. ' +
        'Please refresh the page and try again.'
      );
      
    } catch (error) {
      console.error('[TransferOfferService] Failed to accept transfer:', error.message);
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
