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
const { getTokenStandardTemplateIds, OPERATOR_PARTY_ID, DSO_PARTY_ID, REGISTRY_BACKEND_API, VALIDATOR_SCAN_PROXY_API, TEMPLATE_IDS } = require('../config/constants');
const tokenProvider = require('./tokenProvider');

// Get canton service instance
let cantonServiceInstance = null;
const getCantonService = () => {
  if (!cantonServiceInstance) {
    cantonServiceInstance = require('./cantonService');
  }
  return cantonServiceInstance;
};

// Wallet SDK for Amulet acceptance
let walletSdkService = null;
const getWalletSdkService = () => {
  if (!walletSdkService) {
    try {
      walletSdkService = require('./walletSdkService');
    } catch (e) {
      console.log('[TransferOfferService] Wallet SDK not available:', e.message);
    }
  }
  return walletSdkService;
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
   * Uses the Registry Backend API to get disclosed contracts for Splice transfers.
   * API: https://api.utilities.digitalasset-dev.com/api/token-standard
   * 
   * @param {string} offerContractId - The transfer offer contract ID
   * @param {string} partyId - The party accepting the offer
   * @param {string} token - Admin token
   * @param {string} templateId - Optional template ID (if known)
   * @returns {Object} Result of accepting the offer
   */
  async acceptTransferOffer(offerContractId, partyId, token, templateId = null) {
    await this.initialize();
    
    const registryBackendApi = REGISTRY_BACKEND_API || 'https://api.utilities.digitalasset-dev.com/api/token-standard';
    const TRANSFER_INSTRUCTION_INTERFACE = TEMPLATE_IDS.spliceTransferInstructionInterfaceId || '55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
    
    try {
      console.log(`[TransferOfferService] Accepting transfer offer: ${offerContractId.substring(0, 30)}...`);
      console.log(`[TransferOfferService] Template ID: ${templateId?.substring(0, 60)}...`);
      
      // Check if this is an Amulet transfer (uses different template)
      const isAmuletTransfer = templateId?.includes('AmuletTransferInstruction') || templateId?.includes('Amulet');
      
      // For Amulet transfers, use the Validator Scan Proxy API (NOT Registry Backend API)
      // Amulet/CC comes from the DSO, not utility registrars
      if (isAmuletTransfer) {
        console.log('[TransferOfferService] Detected Amulet transfer - using Validator Scan Proxy API');
        
        const validatorScanProxyApi = VALIDATOR_SCAN_PROXY_API || 'https://validator.dev.canton.wolfedgelabs.com/api/validator';
        const adminToken = token; // The JWT token for API calls
        
        let lastError = null;
        
        try {
          // Step 1: Get AmuletRules contract from Scan Proxy
          // Endpoint: GET /v0/scan-proxy/amulet-rules
          console.log('[TransferOfferService] Step 1: Fetching AmuletRules from Scan Proxy...');
          const amuletRulesUrl = `${validatorScanProxyApi}/v0/scan-proxy/amulet-rules`;
          
          const amuletRulesResponse = await fetch(amuletRulesUrl, {
            method: 'GET',
            headers: { 
              'Authorization': `Bearer ${adminToken}`,
              'Accept': 'application/json'
            },
          });
          
          if (!amuletRulesResponse.ok) {
            const errorText = await amuletRulesResponse.text();
            console.log(`[TransferOfferService] AmuletRules fetch failed: ${amuletRulesResponse.status} - ${errorText.substring(0, 100)}`);
            throw new Error(`Failed to get AmuletRules: ${amuletRulesResponse.status}`);
          }
          
          const amuletRulesData = await amuletRulesResponse.json();
          console.log('[TransferOfferService] ✅ Got AmuletRules contract');
          
          // Step 2: Get Accept choice context from Scan Proxy
          // Endpoint: POST /v0/scan-proxy/registry/transfer-instruction/v1/{contractId}/choice-contexts/accept
          console.log('[TransferOfferService] Step 2: Fetching Accept context from Scan Proxy...');
          const acceptContextUrl = `${validatorScanProxyApi}/v0/scan-proxy/registry/transfer-instruction/v1/${offerContractId}/choice-contexts/accept`;
          
          const acceptContextResponse = await fetch(acceptContextUrl, {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
          });
          
          if (!acceptContextResponse.ok) {
            const errorText = await acceptContextResponse.text();
            console.log(`[TransferOfferService] Accept context fetch failed: ${acceptContextResponse.status} - ${errorText.substring(0, 100)}`);
            throw new Error(`Failed to get Accept context: ${acceptContextResponse.status}`);
          }
          
          const acceptContextData = await acceptContextResponse.json();
          console.log(`[TransferOfferService] ✅ Got Accept context with ${acceptContextData.disclosedContracts?.length || 0} disclosed contracts`);
          
          // Step 3: Prepare disclosed contracts (include AmuletRules if not already present)
          const disclosedContracts = (acceptContextData.disclosedContracts || []).map(dc => ({
            templateId: dc.templateId,
            contractId: dc.contractId,
            createdEventBlob: dc.createdEventBlob,
            synchronizerId: dc.synchronizerId || '',
          }));
          
          // Add AmuletRules to disclosed contracts if it has createdEventBlob
          if (amuletRulesData.createdEventBlob && !disclosedContracts.find(dc => dc.contractId === amuletRulesData.contractId)) {
            disclosedContracts.push({
              templateId: amuletRulesData.templateId,
              contractId: amuletRulesData.contractId,
              createdEventBlob: amuletRulesData.createdEventBlob,
              synchronizerId: '',
            });
          }
          
          // Step 4: Prepare choice context with amulet-rules key
          const choiceContextData = acceptContextData.choiceContextData || acceptContextData.choiceContext?.choiceContextData || { values: {} };
          
          // Ensure amulet-rules is in the context if we have it from the amuletRulesData
          if (amuletRulesData.contractId && (!choiceContextData.values || !choiceContextData.values['amulet-rules'])) {
            if (!choiceContextData.values) choiceContextData.values = {};
            choiceContextData.values['amulet-rules'] = {
              tag: 'AV_ContractId',
              value: amuletRulesData.contractId,
            };
          }
          
          // Step 5: Execute the Accept choice
          console.log('[TransferOfferService] Step 3: Executing TransferInstruction_Accept...');
          const result = await this.cantonService.exerciseChoice({
            token,
            templateId: TRANSFER_INSTRUCTION_INTERFACE,
            contractId: offerContractId,
            choice: 'TransferInstruction_Accept',
            choiceArgument: {
              extraArgs: {
                context: choiceContextData,
                meta: { values: {} }
              }
            },
            actAsParty: [partyId],
            disclosedContracts,
          });
          
          console.log('[TransferOfferService] ✅ Amulet transfer accepted successfully via Validator Scan Proxy!');
          return {
            success: true,
            offerContractId,
            usedValidatorScanProxy: true,
            isAmulet: true,
            result,
          };
          
        } catch (scanProxyError) {
          lastError = scanProxyError;
          console.log(`[TransferOfferService] Validator Scan Proxy approach failed: ${scanProxyError.message}`);
        }
        
        // Fallback: Try Wallet SDK for Amulet
        const sdkService = getWalletSdkService();
        if (sdkService) {
          try {
            console.log('[TransferOfferService] Trying Wallet SDK for Amulet acceptance...');
            const sdkResult = await sdkService.acceptTransfer(offerContractId, partyId);
            
            if (sdkResult.success) {
              console.log('[TransferOfferService] ✅ Amulet transfer accepted via Wallet SDK!');
              return {
                success: true,
                offerContractId,
                usedSdk: true,
                isAmulet: true,
                result: sdkResult.result,
              };
            }
            console.log(`[TransferOfferService] SDK acceptance failed: ${sdkResult.error}`);
          } catch (sdkErr) {
            console.log(`[TransferOfferService] Wallet SDK error: ${sdkErr.message.substring(0, 80)}`);
          }
        }
        
        // All attempts failed
        console.error('[TransferOfferService] All Amulet accept attempts failed');
        
        // Provide a clear error message
        const errorDetails = lastError?.message?.substring(0, 120) || 'Unknown error';
        
        throw new Error(`Amulet (CC) transfer acceptance failed. ${errorDetails}. Please verify the Validator Scan Proxy API is accessible.`);
      }
      
      // For CBTC and other Splice transfers, use the Registry Backend API
      
      // First, get the transfer offer details to find the admin party (registrar)
      let adminPartyId = null;
      let offerContract = null;
      
      try {
        const contracts = await this.cantonService.queryActiveContracts({
          party: partyId,
          interfaceIds: [`#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction`],
        }, token);
        
        offerContract = contracts.find(c => c.contractId === offerContractId);
        if (offerContract) {
          // Extract admin from the transfer details
          const payload = offerContract.payload || offerContract.createdEvent?.createArgument || {};
          const transfer = payload.transfer || payload;
          adminPartyId = transfer.instrumentId?.admin || payload.provider || payload.registrar;
          console.log(`[TransferOfferService] Found admin party: ${adminPartyId?.substring(0, 30)}...`);
        }
      } catch (e) {
        console.log(`[TransferOfferService] Could not query transfer details: ${e.message.substring(0, 80)}`);
      }
      
      // Default to CBTC network if we couldn't find the admin
      if (!adminPartyId) {
        adminPartyId = 'cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff';
        console.log('[TransferOfferService] Using default CBTC admin party');
      }
      
      // Call Registry Backend API to get choice context and disclosed contracts
      console.log('[TransferOfferService] Fetching choice context from Registry Backend API...');
      const adminEncoded = encodeURIComponent(adminPartyId);
      const contextUrl = `${registryBackendApi}/v0/registrars/${adminEncoded}/registry/transfer-instruction/v1/${offerContractId}/choice-contexts/accept`;
      
      const contextResponse = await fetch(contextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
      });
      
      if (!contextResponse.ok) {
        const errorText = await contextResponse.text();
        console.log(`[TransferOfferService] Registry API error: ${contextResponse.status} - ${errorText.substring(0, 100)}`);
        throw new Error(`Registry API returned ${contextResponse.status}`);
      }
      
      const contextData = await contextResponse.json();
      console.log(`[TransferOfferService] Got ${contextData.disclosedContracts?.length || 0} disclosed contracts`);
      
      // Prepare disclosed contracts in the format Canton expects
      const disclosedContracts = (contextData.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId,
        contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob,
        synchronizerId: '',
      }));
      
      // Execute the accept choice with the context and disclosed contracts
      // Handle both response formats: choiceContextData directly or nested in choiceContext
      const choiceContextData = contextData.choiceContextData || contextData.choiceContext?.choiceContextData;
      
      const result = await this.cantonService.exerciseChoice({
        token,
        templateId: TRANSFER_INSTRUCTION_INTERFACE,
        contractId: offerContractId,
        choice: 'TransferInstruction_Accept',
        choiceArgument: {
          extraArgs: {
            context: choiceContextData,
            meta: { values: {} }
          }
        },
        actAsParty: [partyId],
        disclosedContracts,
      });
      
      console.log('[TransferOfferService] ✅ Transfer accepted successfully!');
      return {
        success: true,
        offerContractId,
        usedRegistryApi: true,
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
