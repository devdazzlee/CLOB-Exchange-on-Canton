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
   * Accept a transfer offer (Splice Token Standard TransferInstruction)
   * 
   * Uses a cascading approach:
   * 1. Canton SDK client (uses the Transfer Factory Registry via SDK)
   * 2. Direct Scan Proxy API (local validator at http://65.108.40.104:8088)
   * 3. Legacy external Registry Backend API (fallback)
   * 
   * @param {string} offerContractId - The transfer offer contract ID
   * @param {string} partyId - The party accepting the offer
   * @param {string} token - Admin token
   * @param {string} templateId - Optional template ID (if known)
   * @returns {Object} Result of accepting the offer
   */
  async acceptTransferOffer(offerContractId, partyId, token, templateId = null) {
    await this.initialize();
    
    const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
    
    try {
      console.log(`[TransferOfferService] Accepting transfer: ${offerContractId.substring(0, 30)}... for ${partyId.substring(0, 30)}...`);
      if (templateId) {
        console.log(`[TransferOfferService] Template hint: ${templateId.substring(0, 60)}...`);
      }
      
      // ─── Detect token type from template ID ────────────────────────────────────
      // Utility.Registry.App → CBTC (Utilities token)
      // Splice.Amulet → CC (Amulet/Splice token)
      let detectedSymbol = null;
      const templateLower = (templateId || '').toLowerCase();
      if (templateLower.includes('utility') || templateLower.includes('cbtc')) {
        detectedSymbol = 'CBTC';
        console.log(`[TransferOfferService] Detected: CBTC (Utilities token)`);
      } else if (templateLower.includes('amulet') || templateLower.includes('splice.amulet')) {
        detectedSymbol = 'CC';
        console.log(`[TransferOfferService] Detected: CC (Amulet/Splice token)`);
      } else {
        console.log(`[TransferOfferService] Token type unknown from template, will try all approaches`);
      }
      
      // ─── Approach 1: Canton SDK client ─────────────────────────────────────────
      const sdkClient = getSDKClient();
      if (sdkClient && sdkClient.isReady()) {
        try {
          console.log(`[TransferOfferService] Using Canton SDK to accept transfer (symbol: ${detectedSymbol || 'auto'})...`);
          const result = await sdkClient.acceptTransfer(offerContractId, partyId, detectedSymbol);
          console.log('[TransferOfferService] ✅ Transfer accepted via Canton SDK!');
          return { success: true, offerContractId, usedSdk: true, result };
        } catch (sdkError) {
          console.log(`[TransferOfferService] SDK accept failed: ${(sdkError?.message || String(sdkError)).substring(0, 120)}`);
        }
      } else {
        console.log('[TransferOfferService] SDK not ready, skipping SDK approach');
      }
      
      const adminToken = token || await tokenProvider.getServiceToken();
      
      // ─── Approach 2: Utilities/Registry Backend API (for CBTC) ────────────────
      // Tries multiple URL patterns for the accept choice context
      if (detectedSymbol === 'CBTC' || !detectedSymbol) {
        const backendUrl = UTILITIES_CONFIG.BACKEND_URL;
        const adminParty = UTILITIES_CONFIG.CBTC_ADMIN_PARTY;
        const encodedCid = encodeURIComponent(offerContractId);
        const scanProxyBase = SCAN_PROXY_API || 'http://65.108.40.104:8088';
        
        const utilitiesUrls = [
          // Pattern 1: Token Standard API (client-provided URL)
          `${backendUrl}/v0/registrars/${encodeURIComponent(adminParty)}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
          // Pattern 2: Without encoding admin party
          `${backendUrl}/v0/registrars/${adminParty}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
          // Pattern 3: Scan Proxy registry endpoint
          `${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`,
          // Pattern 4: Validator API direct accept
          `${scanProxyBase}/api/validator/v0/wallet/transfer-offers/${encodedCid}/accept`,
        ];
        
        for (const acceptContextUrl of utilitiesUrls) {
          try {
            console.log(`[TransferOfferService] Trying: ${acceptContextUrl.substring(0, 120)}...`);
            
            // Scan proxy registry endpoints only support GET (POST returns 405).
            // Backend/Validator wallet endpoints support POST.
            const isScanProxy = acceptContextUrl.startsWith(scanProxyBase) && !acceptContextUrl.includes('/wallet/');
            const fetchOpts = isScanProxy
              ? {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Accept': 'application/json',
                  },
                }
              : {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                  },
                  body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
                };
            
            const contextResponse = await fetch(acceptContextUrl, fetchOpts);
            
            if (contextResponse.ok) {
              const acceptContext = await contextResponse.json();
              
              // If validator API direct accept (Pattern 4), it accepted directly
              if (acceptContextUrl.includes('/wallet/transfer-offers/')) {
                console.log('[TransferOfferService] ✅ Transfer accepted directly via Validator API!');
                return { success: true, offerContractId, usedValidatorApi: true, result: acceptContext };
              }
              
              console.log(`[TransferOfferService] ✅ Got accept context (${acceptContext.disclosedContracts?.length || 0} disclosed contracts)`);
              
              // Default synchronizerId from config (REQUIRED by Canton JSON API v2)
              const defaultSyncId = config.canton.synchronizerId;
              
              const disclosedContracts = (acceptContext.disclosedContracts || []).map(dc => ({
                templateId: dc.templateId,
                contractId: dc.contractId,
                createdEventBlob: dc.createdEventBlob,
                synchronizerId: dc.synchronizerId || defaultSyncId,
              }));
              
              const choiceContextData = acceptContext.choiceContextData || acceptContext.choiceContext?.choiceContextData || { values: {} };
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
                actAsParty: [partyId],
                disclosedContracts,
                synchronizerId: defaultSyncId,
              });
              
              console.log('[TransferOfferService] ✅ Transfer accepted via Utilities Backend API!');
              return { success: true, offerContractId, usedUtilitiesApi: true, result };
            } else {
              const errorText = await contextResponse.text();
              console.log(`[TransferOfferService] ${contextResponse.status}: ${errorText.substring(0, 150)}`);
            }
          } catch (utilError) {
            console.log(`[TransferOfferService] Failed: ${(utilError?.message || String(utilError)).substring(0, 120)}`);
          }
        }
        console.log(`[TransferOfferService] All Utilities/Registry URL patterns failed for CBTC`);
      }
      
      // ─── Approach 3: Scan Proxy API (for CC/Amulet) ────────────────────────────
      // NOTE: /api/validator/v0/scan-proxy/ prefix only supports GET (registry lookups),
      //       NOT POST (choice-contexts). Using POST returns 405 Method Not Allowed.
      //       Only use the direct registry path which supports POST for choice-contexts.
      if (detectedSymbol === 'CC' || !detectedSymbol) {
        const scanProxyBase = SCAN_PROXY_API || 'http://65.108.40.104:8088';
        
        const urlPatterns = [
          `${scanProxyBase}/registry/transfer-instruction/v1/${offerContractId}/choice-contexts/accept`,
        ];
        
        for (const acceptUrl of urlPatterns) {
          try {
            console.log(`[TransferOfferService] Trying Scan Proxy: ${acceptUrl.substring(0, 80)}...`);
            
            // Scan proxy registry endpoints only support GET (POST returns 405 Method Not Allowed)
            const contextResponse = await fetch(acceptUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Accept': 'application/json',
              },
            });
            
            if (!contextResponse.ok) {
              const errorText = await contextResponse.text();
              console.log(`[TransferOfferService] ${contextResponse.status}: ${errorText.substring(0, 100)}`);
              continue;
            }
            
            const contextData = await contextResponse.json();
            console.log(`[TransferOfferService] ✅ Got choice context (${contextData.disclosedContracts?.length || 0} disclosed contracts)`);
            
            const defaultSyncId2 = config.canton.synchronizerId;
            const disclosedContracts = (contextData.disclosedContracts || []).map(dc => ({
              templateId: dc.templateId,
              contractId: dc.contractId,
              createdEventBlob: dc.createdEventBlob,
              synchronizerId: dc.synchronizerId || defaultSyncId2,
            }));
            
            const choiceContextData = contextData.choiceContextData || contextData.choiceContext?.choiceContextData || { values: {} };
            
            const result = await this.cantonService.exerciseChoice({
              token: adminToken,
              templateId: TRANSFER_INSTRUCTION_INTERFACE,
              contractId: offerContractId,
              choice: 'TransferInstruction_Accept',
              choiceArgument: {
                extraArgs: {
                  context: choiceContextData,
                  meta: { values: {} },
                },
              },
              actAsParty: [partyId],
              disclosedContracts,
              synchronizerId: defaultSyncId2,
            });
            
            console.log('[TransferOfferService] ✅ Transfer accepted via Scan Proxy!');
            return { success: true, offerContractId, usedScanProxy: true, result };
          } catch (urlError) {
            console.log(`[TransferOfferService] URL pattern failed: ${(urlError?.message || String(urlError)).substring(0, 100)}`);
          }
        }
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
