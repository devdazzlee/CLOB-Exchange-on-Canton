/**
 * Transfer Offer Service - Handle Canton/Splice Token Transfers
 *
 * Follows the official Splice Token Standard for 2-step transfers:
 *   Ref: https://docs.digitalasset.com/utilities/devnet/how-tos/registry/transfer/transfer.html
 *
 * CC (Amulet)  → Scan Proxy registry
 * CBTC (Utilities) → Utilities Backend API at /v0/registrars/{ADMIN}/registry/…
 *
 * The ADMIN_PARTY_ID (registrar) is extracted from the contract's
 * transfer.instrumentId.admin field — never hardcoded.
 */

const config = require('../config');
const { OPERATOR_PARTY_ID, DSO_PARTY_ID, SCAN_PROXY_API, VALIDATOR_SCAN_PROXY_API, getTokenStandardTemplateIds } = require('../config/constants');
const { UTILITIES_CONFIG, CANTON_SDK_CONFIG } = require('../config/canton-sdk.config');
const {
  transferInstructionAcceptActAs,
  transferInstructionAcceptReadAs,
} = require('./ledgerInteractiveSubmissionPolicy');
const tokenProvider = require('./tokenProvider');
const { getRegistryApi } = require('../http/clients');

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

  // ═══════════════════════════════════════════════════════════════════════════
  // Query pending transfer offers
  // ═══════════════════════════════════════════════════════════════════════════

  async getTransferOffers(partyId, token) {
    await this.initialize();

    try {
      console.log(`[TransferOfferService] Querying transfer offers for: ${partyId.substring(0, 30)}...`);

      let allOffers = [];

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

      if (allOffers.length === 0) {
        console.log(`[TransferOfferService] Fallback: querying all contracts...`);
        const allContracts = await this.cantonService.queryActiveContracts({
          party: partyId,
          templateIds: [],
        }, token);
        console.log(`[TransferOfferService] Found ${allContracts.length} total contracts`);

        const transferContracts = allContracts.filter(contract => {
          const tid = (contract.createdEvent?.templateId || contract.templateId || '').toLowerCase();
          if (tid.includes('executedtransfer') || tid.includes('completedtransfer') || tid.includes('archivedtransfer')) return false;
          return tid.includes('transferinstruction') || tid.includes('transferoffer') ||
                 tid.includes('transfer_instruction') || tid.includes('transfer_offer') ||
                 (tid.includes('instruction') && tid.includes('transfer'));
        });
        allOffers.push(...transferContracts);
      }

      console.log(`[TransferOfferService] Found ${allOffers.length} potential transfer offers`);

      return allOffers.map(contract => {
        const templateId = contract.createdEvent?.templateId || contract.templateId || '';

        // Canton v2 InterfaceFilter returns data in createdEvent.interfaceViews[].viewValue
        // while the raw template payload is in createdEvent.createArgument (= contract.payload).
        const ifaceView = contract.createdEvent?.interfaceViews?.[0]?.viewValue || {};
        const payload = contract.payload || contract.interfaceView || {};

        // The interface view uses "transfer.instrumentId" structure;
        // the raw payload may use the same or template-specific field names.
        const transferData = ifaceView.transfer || payload.transfer || {};

        const tokenSymbol = transferData.instrumentId?.id ||
                            transferData.instrument?.id ||
                            ifaceView.instrumentId?.id ||
                            payload.instrumentId?.id ||
                            payload.token || payload.asset || 'Unknown';

        const amount = transferData.amount || ifaceView.amount || payload.amount || payload.quantity || '0';

        const sender = transferData.sender || ifaceView.sender || payload.sender || payload.provider || payload.from || 'unknown';
        const receiver = transferData.receiver || ifaceView.receiver || payload.receiver || payload.recipient || payload.to || partyId;

        // The registrar (instrument admin) — needed by the accept choice context API.
        // Per Splice Token Standard, this is transfer.instrumentId.admin.
        const registrarParty = transferData.instrumentId?.admin ||
                               ifaceView.instrumentId?.admin ||
                               payload.instrumentId?.admin ||
                               null;

        if (registrarParty) {
          console.log(`[TransferOfferService] Offer ${(contract.contractId || '').substring(0, 20)}... registrar: ${registrarParty.substring(0, 50)}...`);
        }

        return {
          contractId: contract.contractId,
          templateId,
          payload,
          sender,
          receiver,
          amount,
          token: tokenSymbol,
          registrarParty,
          isSplice: templateId.toLowerCase().includes('splice') || !!contract.interfaceView,
        };
      });

    } catch (error) {
      console.error('[TransferOfferService] Failed to get transfer offers:', error.message);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Prepare transfer accept (interactive signing)
  // ═══════════════════════════════════════════════════════════════════════════

  async prepareTransferAccept(offerContractId, partyId, token, templateId = null, registrarParty = null) {
    await this.initialize();

    const TRANSFER_INSTRUCTION_INTERFACE = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    try {
      console.log(`[TransferOfferService] PREPARE transfer accept: ${offerContractId.substring(0, 30)}... for ${partyId.substring(0, 30)}...`);
      if (registrarParty) {
        console.log(`[TransferOfferService] Registrar (instrument admin): ${registrarParty.substring(0, 50)}...`);
      }

      const operatorPartyId = config.canton.operatorPartyId;
      const configuredSync = config.canton.synchronizerId;
      // Use executor token (cardiv) — it carries actAs rights for user parties
      // granted at onboarding time, avoiding the validator-operator TOO_MANY_USER_RIGHTS.
      const adminToken = await tokenProvider.getExecutorToken();
      const synchronizerId = await this.cantonService.resolveSubmissionSynchronizerId(
        adminToken,
        configuredSync
      );

      const actAsParties = transferInstructionAcceptActAs(partyId);
      const readAsParties = transferInstructionAcceptReadAs(partyId, operatorPartyId);

      console.log(`[TransferOfferService] actAs: [${actAsParties.map(p => p.substring(0, 30) + '...').join(', ')}]`);
      console.log(`[TransferOfferService] readAs: [${readAsParties.map(p => p.substring(0, 30) + '...').join(', ')}]`);

      const { disclosedContracts, choiceContextData } = await this._getAcceptChoiceContext(
        offerContractId, adminToken, synchronizerId, templateId, registrarParty
      );

      const utilitiesInterface = UTILITIES_CONFIG.TRANSFER_INSTRUCTION_INTERFACE || TRANSFER_INSTRUCTION_INTERFACE;

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
        verboseHashing: false,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Execute prepared transfer accept with user signature
  // ═══════════════════════════════════════════════════════════════════════════

  async executeTransferAccept(preparedTransaction, partyId, signatureBase64, signedBy, token, hashingSchemeVersion = 1) {
    await this.initialize();

    try {
      console.log(`[TransferOfferService] EXECUTE transfer accept for ${partyId.substring(0, 30)}...`);

      // Must match prepareTransferAccept (executor OAuth client — onboarding grants).
      const adminToken = token || await tokenProvider.getExecutorToken();

      const partySignatures = {
        signatures: [{
          party: partyId,
          signatures: [{
            format: 'SIGNATURE_FORMAT_RAW',
            signature: signatureBase64,
            signedBy,
            signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
          }],
        }],
      };

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

  // ═══════════════════════════════════════════════════════════════════════════
  // Accept transfer offer (orchestrator)
  // ═══════════════════════════════════════════════════════════════════════════

  async acceptTransferOffer(offerContractId, partyId, token, templateId = null, registrarParty = null) {
    await this.initialize();

    try {
      console.log(`[TransferOfferService] Accepting transfer: ${offerContractId.substring(0, 30)}... for ${partyId.substring(0, 30)}...`);
      if (templateId) console.log(`[TransferOfferService] Template hint: ${templateId.substring(0, 60)}...`);
      if (registrarParty) console.log(`[TransferOfferService] Registrar: ${registrarParty.substring(0, 50)}...`);

      console.log(`[TransferOfferService] Using interactive submission (2-step flow)`);

      const prepareResult = await this.prepareTransferAccept(offerContractId, partyId, token, templateId, registrarParty);
      return { ...prepareResult, requiresSignature: true };

    } catch (error) {
      console.error('[TransferOfferService] Failed to accept transfer:', error.message);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Choice context resolution — per official DA Token Standard docs
  //
  // Ref: https://docs.digitalasset.com/utilities/devnet/overview/registry-user-guide/token-standard.html
  // URL: ${TOKEN_STANDARD_URL}/v0/registrars/${REGISTRAR}/registry/transfer-instruction/v1/${CID}/choice-contexts/accept
  //
  // The REGISTRAR is the instrument admin extracted from the contract's
  // transfer.instrumentId.admin field.
  // ═══════════════════════════════════════════════════════════════════════════

  async _getAcceptChoiceContext(offerContractId, adminToken, synchronizerId, templateHint = null, registrarParty = null) {
    const encodedCid = encodeURIComponent(offerContractId);
    const tokenStandardBase = UTILITIES_CONFIG.TOKEN_STANDARD_URL;
    const scanProxyBase = CANTON_SDK_CONFIG.REGISTRY_API_URL || SCAN_PROXY_API || 'http://65.108.40.104:8088';

    const isSpliceToken = templateHint?.includes('Amulet') || templateHint?.includes('Splice')
      || (registrarParty && registrarParty.startsWith('DSO::'));

    const urls = [];

    if (isSpliceToken) {
      urls.push(`${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
      if (registrarParty) {
        const encoded = encodeURIComponent(registrarParty);
        urls.push(`${tokenStandardBase}/v0/registrars/${encoded}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
      }
    } else {
      if (registrarParty) {
        const encoded = encodeURIComponent(registrarParty);
        urls.push(`${tokenStandardBase}/v0/registrars/${encoded}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
      }
      urls.push(`${scanProxyBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/accept`);
    }

    console.log(`[TransferOfferService] Resolving accept context — registrar: ${(registrarParty || 'unknown').substring(0, 50)}, ${urls.length} endpoints, splice=${isSpliceToken}`);

    const errors = [];
    let notFoundCount = 0;

    for (const url of urls) {
      try {
        console.log(`[TransferOfferService] Trying: ${url.substring(0, 140)}...`);
        const { data: ctx } = await getRegistryApi().post(url, { meta: {}, excludeDebugFields: true }, {
          headers: { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' },
        });

        console.log(`[TransferOfferService] Got accept context (${ctx.disclosedContracts?.length || 0} disclosed, ${Object.keys(ctx.choiceContextData?.values || {}).length} context keys)`);
        const disclosedContracts = (ctx.disclosedContracts || []).map(dc => ({
          templateId: dc.templateId,
          contractId: dc.contractId,
          createdEventBlob: dc.createdEventBlob,
          synchronizerId: dc.synchronizerId || synchronizerId,
        }));
        const choiceContextData = ctx.choiceContextData || ctx.choiceContext?.choiceContextData || { values: {} };
        return { disclosedContracts, choiceContextData };
      } catch (err) {
        if (err.code === 'CONTRACT_NOT_FOUND') throw err;

        const status = err.response?.status;
        const respData = typeof err.response?.data === 'string' ? err.response?.data : JSON.stringify(err.response?.data || {});
        const is404 = status === 404 || respData.includes('CONTRACT_NOT_FOUND') || respData.includes('not found');

        if (is404) {
          notFoundCount++;
          const msg = `404 from ${url.substring(0, 80)}...`;
          console.log(`[TransferOfferService] ${msg} — trying next endpoint`);
          errors.push(msg);
          continue;
        }

        const msg = (err?.message || String(err)).substring(0, 140);
        console.log(`[TransferOfferService] Failed: ${msg}`);
        errors.push(msg);
      }
    }

    if (notFoundCount === urls.length) {
      const archiveErr = new Error(`Transfer contract ${offerContractId.substring(0, 20)}... no longer exists (archived/expired)`);
      archiveErr.code = 'CONTRACT_NOT_FOUND';
      throw archiveErr;
    }

    throw new Error(
      `Could not get accept choice context after ${errors.length} endpoints. ` +
      `Registrar: ${registrarParty || 'unknown'}. Last error: ${errors[errors.length - 1] || 'none'}`
    );
  }

  /**
   * Discover the operator party from the Utilities Backend.
   * Ref: https://api.utilities.digitalasset-dev.com/api/utilities/v0/operator
   */
  async _discoverOperatorParty() {
    if (this._cachedOperatorParty !== undefined) return this._cachedOperatorParty;

    const url = `${UTILITIES_CONFIG.BACKEND_URL}/v0/operator`;
    try {
      const { data } = await getRegistryApi().get(url, { headers: { Accept: 'application/json' }, timeout: 8000 });
      const partyId = data?.partyId || null;
      if (partyId) {
        console.log(`[TransferOfferService] Discovered operator party: ${partyId.substring(0, 50)}...`);
      }
      this._cachedOperatorParty = partyId;
      return partyId;
    } catch (e) {
      console.log(`[TransferOfferService] Could not discover operator: ${(e?.message || '').substring(0, 80)}`);
    }
    this._cachedOperatorParty = null;
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // List external tokens
  // ═══════════════════════════════════════════════════════════════════════════

  async listExternalTokens(token) {
    await this.initialize();

    try {
      const templateIds = getTokenStandardTemplateIds();
      const instruments = await this.cantonService.queryActiveContracts({
        party: OPERATOR_PARTY_ID,
        templateIds: [templateIds.instrument],
      }, token);

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
