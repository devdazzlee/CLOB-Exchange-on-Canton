/**
 * Settlement Service - Handles atomic DvP (Delivery vs Payment)
 * 
 * When orders match:
 * 1. Create SettlementInstruction with both locked Holdings
 * 2. Execute settlement atomically:
 *    - Buyer's USDT → Seller
 *    - Seller's BTC → Buyer
 * 3. All in one transaction (or entire rollback)
 * 
 * Uses Canton JSON Ledger API v2:
 * - POST /v2/commands/submit-and-wait-for-transaction
 * 
 * DAML Templates (package f552adda...):
 * - Settlement:SettlementInstruction - Holds locked Holding references
 * - Settlement:Trade - Created atomically during settlement
 * - Holding:Holding - Locked/transferred during settlement
 */

const cantonService = require('./cantonService');
const config = require('../config');
const { getTokenStandardTemplateIds, TEMPLATE_IDS } = require('../config/constants');

// Template IDs from centralized constants
const getTemplateIds = () => getTokenStandardTemplateIds();

class SettlementService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    this.initialized = true;
    console.log('[SettlementService] Initialized with DvP support');
  }

  /**
   * Create a SettlementInstruction contract on Canton
   * 
   * Uses cantonService.createContract() (NOT submitCommand which doesn't exist)
   */
  async createSettlementInstruction(params, adminToken) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton.operatorPartyId;
    const synchronizerId = config.canton.synchronizerId;

    try {
      console.log('[SettlementService] Creating SettlementInstruction...');
      console.log(`  Template: ${templateIds.settlement}`);
      console.log(`  Buyer Holding: ${params.buyerHoldingCid?.substring(0, 30)}...`);
      console.log(`  Seller Holding: ${params.sellerHoldingCid?.substring(0, 30)}...`);

      const result = await cantonService.createContract({
        token: adminToken,
        actAsParty: operatorPartyId,
        templateId: templateIds.settlement,
        createArguments: {
          operator: operatorPartyId,
          buyer: params.buyer,
          seller: params.seller,
          baseInstrumentId: {
            issuer: operatorPartyId,
            symbol: params.baseSymbol,
            version: '1.0',
          },
          quoteInstrumentId: {
            issuer: operatorPartyId,
            symbol: params.quoteSymbol,
            version: '1.0',
          },
          baseAmount: params.baseAmount.toString(),
          quoteAmount: params.quoteAmount.toString(),
          price: params.price.toString(),
          buyerHoldingCid: params.buyerHoldingCid,
          sellerHoldingCid: params.sellerHoldingCid,
          buyOrderId: params.buyOrderId,
          sellOrderId: params.sellOrderId,
          timestamp: new Date().toISOString(),
          status: { tag: 'SettlementPending', value: {} },
        },
        readAs: [operatorPartyId, params.buyer, params.seller],
        synchronizerId,
      });

      // Extract the created SettlementInstruction contract ID from response
      let settlementCid = null;
      const events = result?.transaction?.events || result?.events || [];
      for (const event of events) {
        const created = event.created || event.CreatedEvent || event;
        const tplId = created?.templateId || '';
        const tplStr = typeof tplId === 'string' ? tplId : 
          `${tplId.packageId || ''}:${tplId.moduleName || ''}:${tplId.entityName || ''}`;
        
        if (tplStr.includes('Settlement') && tplStr.includes('SettlementInstruction')) {
          settlementCid = created?.contractId;
          break;
        }
      }

      // Fallback: get from first created event
      if (!settlementCid) {
        for (const event of events) {
          const created = event.created || event.CreatedEvent || event;
          if (created?.contractId) {
            settlementCid = created.contractId;
            break;
          }
        }
      }

      console.log(`[SettlementService] ✅ Created SettlementInstruction: ${settlementCid?.substring(0, 30)}...`);
      return { settlementCid, result };
    } catch (error) {
      console.error('[SettlementService] ❌ Failed to create SettlementInstruction:', error.message);
      throw error;
    }
  }

  /**
   * Execute a settlement atomically (DvP)
   * 
   * This exercises Settlement_Execute on the SettlementInstruction contract.
   * The DAML choice atomically:
   * - Archives both locked Holdings
   * - Creates new Holdings for buyer (gets base) and seller (gets quote)
   * - Handles change (if locked amount > trade amount)
   * - Creates a Trade record
   */
  async executeSettlement(settlementCid, adminToken) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton.operatorPartyId;

    try {
      console.log(`[SettlementService] Executing Settlement_Execute on ${settlementCid?.substring(0, 30)}...`);

      const result = await cantonService.exerciseChoice({
        token: adminToken,
        templateId: templateIds.settlement,
        contractId: settlementCid,
        choice: 'Settlement_Execute',
        choiceArgument: {},
        actAsParty: operatorPartyId,
        readAs: [operatorPartyId],
      });

      // Extract the Trade contract ID AND newly created Holdings from the result
      let tradeCid = null;
      const createdHoldings = [];
      const events = result?.transaction?.events || result?.events || [];
      for (const event of events) {
        const created = event.created || event.CreatedEvent || event;
        const tplId = created?.templateId || '';
        const tplStr = typeof tplId === 'string' ? tplId : 
          `${tplId.packageId || ''}:${tplId.moduleName || ''}:${tplId.entityName || ''}`;
        
        if (tplStr.includes('Trade')) {
          tradeCid = created?.contractId;
        }
        if (tplStr.includes('Holding') && created?.contractId) {
          const args = created.createArgument || created.createArguments || {};
          createdHoldings.push({
            contractId: created.contractId,
            owner: args.owner,
            symbol: args.instrumentId?.symbol || args.instrumentId?.id || 'UNKNOWN',
            amount: parseFloat(args.amount) || 0,
            locked: !!args.lock,
          });
        }
      }

      console.log(`[SettlementService] ✅ Settlement executed, Trade: ${tradeCid?.substring(0, 30)}...`);
      if (createdHoldings.length > 0) {
        console.log(`[SettlementService]    Created ${createdHoldings.length} Holdings:`);
        for (const h of createdHoldings) {
          console.log(`[SettlementService]    - ${h.symbol} ${h.amount} → ${h.owner?.substring(0, 30)}... (locked: ${h.locked})`);
        }
      }
      return { tradeCid, createdHoldings, result };
    } catch (error) {
      console.error('[SettlementService] ❌ Settlement execution failed:', error.message);
      throw error;
    }
  }

  /**
   * Cancel a settlement (returns locked funds)
   */
  async cancelSettlement(settlementCid, reason, adminToken) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton.operatorPartyId;

    try {
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        templateId: templateIds.settlement,
        contractId: settlementCid,
        choice: 'Settlement_Cancel',
        choiceArgument: { reason },
        actAsParty: operatorPartyId,
      });

      console.log('[SettlementService] Settlement cancelled, funds returned');
      return result;
    } catch (error) {
      console.error('[SettlementService] Settlement cancellation failed:', error.message);
      throw error;
    }
  }

  /**
   * Execute immediate settlement for a match
   * This is the main entry point called by the matching engine
   * 
   * Steps:
   * 1. Create SettlementInstruction with locked Holding CIDs
   * 2. Execute Settlement_Execute (atomic DvP)
   * 3. Return trade info
   */
  async settleMatch(match, adminToken) {
    const { buyOrder, sellOrder, fillQuantity, fillPrice } = match;

    // Calculate amounts
    const baseAmount = fillQuantity;
    const quoteAmount = fillQuantity * fillPrice;

    // Extract trading pair info
    const [baseSymbol, quoteSymbol] = buyOrder.tradingPair.split('/');

    console.log(`[SettlementService] ═══════════════════════════════════════`);
    console.log(`[SettlementService] Settling match: ${fillQuantity} ${baseSymbol} @ ${fillPrice} ${quoteSymbol}`);
    console.log(`[SettlementService] Quote total: ${quoteAmount} ${quoteSymbol}`);
    console.log(`[SettlementService] Buyer: ${buyOrder.owner.substring(0, 40)}...`);
    console.log(`[SettlementService] Seller: ${sellOrder.owner.substring(0, 40)}...`);
    console.log(`[SettlementService] Buyer Holding (locked USDT): ${buyOrder.lockedHoldingCid?.substring(0, 30)}...`);
    console.log(`[SettlementService] Seller Holding (locked BTC): ${sellOrder.lockedHoldingCid?.substring(0, 30)}...`);

    // Validate we have locked Holding CIDs
    if (!buyOrder.lockedHoldingCid || !sellOrder.lockedHoldingCid) {
      throw new Error('Both buy and sell orders must have locked Holding CIDs for DvP settlement');
    }

    try {
      // Step 1: Create SettlementInstruction
      const { settlementCid } = await this.createSettlementInstruction({
        buyer: buyOrder.owner,
        seller: sellOrder.owner,
        baseSymbol,
        quoteSymbol,
        baseAmount,
        quoteAmount,
        price: fillPrice,
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        buyerHoldingCid: buyOrder.lockedHoldingCid,
        sellerHoldingCid: sellOrder.lockedHoldingCid,
      }, adminToken);

      if (!settlementCid) {
        throw new Error('Failed to get SettlementInstruction contract ID');
      }

      // Step 2: Execute DvP (atomic swap of Holdings + Trade creation)
      const { tradeCid, createdHoldings } = await this.executeSettlement(settlementCid, adminToken);

      console.log(`[SettlementService] ✅ DvP Settlement complete!`);
      console.log(`[SettlementService] ═══════════════════════════════════════`);

      return {
        success: true,
        tradeContractId: tradeCid || `trade-${Date.now()}`,
        settlementCid,
        baseAmount,
        quoteAmount,
        price: fillPrice,
        createdHoldings: createdHoldings || [],
      };
    } catch (error) {
      console.error(`[SettlementService] ❌ Match settlement failed:`, error.message);
      // On failure, the SettlementInstruction may exist but was not executed
      // The locked Holdings remain locked - they need manual cleanup or retry
      throw error;
    }
  }
}

// Singleton
let settlementServiceInstance = null;

function getSettlementService() {
  if (!settlementServiceInstance) {
    settlementServiceInstance = new SettlementService();
  }
  return settlementServiceInstance;
}

module.exports = {
  SettlementService,
  getSettlementService,
};
