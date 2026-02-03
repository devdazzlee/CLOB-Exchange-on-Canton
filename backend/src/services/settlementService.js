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
 * This ensures no partial state - both parties either
 * complete the trade or nothing happens.
 */

const cantonService = require('./cantonService');
const { getHoldingService } = require('./holdingService');
const { getInstrumentService } = require('./instrumentService');
const config = require('../config');

// Helper to get canton service instance
const getCantonService = () => cantonService;

// Template IDs - Use Token Standard package for Settlement
const getTemplateIds = () => {
  const tokenStandardPackageId = config.canton?.tokenStandardPackageId || 
                                  process.env.TOKEN_STANDARD_PACKAGE_ID ||
                                  '813a7f5a2d053bb8e408035cf0a7f86d216f62b216eb6a6e157b253d0d2ccb69';
  return {
    settlement: `${tokenStandardPackageId}:Settlement:SettlementInstruction`,
    trade: `${tokenStandardPackageId}:Settlement:Trade`,
    batchSettlement: `${tokenStandardPackageId}:Settlement:BatchSettlement`,
  };
};

class SettlementService {
  constructor() {
    this.cantonService = null;
  }

  async initialize() {
    this.cantonService = getCantonService();
    console.log('[SettlementService] Initialized with DvP support');
  }

  /**
   * Create a SettlementInstruction for matching orders
   * 
   * @param {Object} params
   * @param {string} params.buyer - Buyer party ID
   * @param {string} params.seller - Seller party ID
   * @param {string} params.baseSymbol - Base asset (e.g., "cBTC")
   * @param {string} params.quoteSymbol - Quote asset (e.g., "USDT")
   * @param {number} params.baseAmount - Amount of base asset
   * @param {number} params.quoteAmount - Amount of quote asset (price * baseAmount)
   * @param {number} params.price - Trade price
   * @param {string} params.buyOrderId - Buy order ID
   * @param {string} params.sellOrderId - Sell order ID
   * @param {string} params.buyerHoldingCid - Buyer's locked USDT Holding contract ID
   * @param {string} params.sellerHoldingCid - Seller's locked BTC Holding contract ID
   * @param {string} params.adminToken - Admin OAuth token
   */
  async createSettlementInstruction(params, adminToken) {
    const cantonService = getCantonService();
    const instrumentService = getInstrumentService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const baseInstrumentId = instrumentService.getInstrumentId(params.baseSymbol);
      const quoteInstrumentId = instrumentService.getInstrumentId(params.quoteSymbol);

      const result = await cantonService.submitCommand({
        token: adminToken,
        actAs: [operatorPartyId],
        readAs: [operatorPartyId, params.buyer, params.seller],
        commands: [{
          CreateCommand: {
            templateId: templateIds.settlement,
            createArguments: {
              operator: operatorPartyId,
              buyer: params.buyer,
              seller: params.seller,
              baseInstrumentId: baseInstrumentId,
              quoteInstrumentId: quoteInstrumentId,
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
          },
        }],
      });

      console.log('[SettlementService] Created settlement instruction');
      return result;
    } catch (error) {
      console.error('[SettlementService] Failed to create settlement:', error.message);
      throw error;
    }
  }

  /**
   * Execute a settlement atomically (DvP)
   */
  async executeSettlement(settlementCid, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        templateId: templateIds.settlement,
        contractId: settlementCid,
        choice: 'Settlement_Execute',
        choiceArgument: {},
        actAsParty: operatorPartyId,
      });

      console.log('[SettlementService] Settlement executed - DvP complete');
      return result;
    } catch (error) {
      console.error('[SettlementService] Settlement execution failed:', error.message);
      throw error;
    }
  }

  /**
   * Cancel a settlement (returns locked funds)
   */
  async cancelSettlement(settlementCid, reason, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

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
   * Get pending settlements
   */
  async getPendingSettlements(adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const settlements = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [templateIds.settlement],
      }, adminToken);

      return settlements.map(s => ({
        contractId: s.contractId,
        buyer: s.payload.buyer,
        seller: s.payload.seller,
        baseSymbol: s.payload.baseInstrumentId?.symbol,
        quoteSymbol: s.payload.quoteInstrumentId?.symbol,
        baseAmount: s.payload.baseAmount,
        quoteAmount: s.payload.quoteAmount,
        price: s.payload.price,
        buyOrderId: s.payload.buyOrderId,
        sellOrderId: s.payload.sellOrderId,
        timestamp: s.payload.timestamp,
        status: s.payload.status,
      }));
    } catch (error) {
      console.error('[SettlementService] Failed to get settlements:', error.message);
      throw error;
    }
  }

  /**
   * Get executed trades
   */
  async getTrades(tradingPair, limit, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const trades = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [templateIds.trade],
      }, adminToken);

      let filtered = trades;
      
      // Filter by trading pair if specified
      if (tradingPair) {
        const [baseSymbol, quoteSymbol] = tradingPair.split('/');
        filtered = trades.filter(t => 
          t.payload.baseInstrumentId?.symbol === baseSymbol &&
          t.payload.quoteInstrumentId?.symbol === quoteSymbol
        );
      }

      // Sort by timestamp descending
      filtered.sort((a, b) => 
        new Date(b.payload.timestamp) - new Date(a.payload.timestamp)
      );

      // Apply limit
      if (limit) {
        filtered = filtered.slice(0, limit);
      }

      return filtered.map(t => ({
        tradeId: t.payload.tradeId,
        contractId: t.contractId,
        buyer: t.payload.buyer,
        seller: t.payload.seller,
        tradingPair: `${t.payload.baseInstrumentId?.symbol}/${t.payload.quoteInstrumentId?.symbol}`,
        baseAmount: t.payload.baseAmount,
        quoteAmount: t.payload.quoteAmount,
        price: t.payload.price,
        buyOrderId: t.payload.buyOrderId,
        sellOrderId: t.payload.sellOrderId,
        timestamp: t.payload.timestamp,
      }));
    } catch (error) {
      console.error('[SettlementService] Failed to get trades:', error.message);
      throw error;
    }
  }

  /**
   * Get trades for a specific user
   */
  async getUserTrades(partyId, limit, adminToken) {
    const trades = await this.getTrades(null, null, adminToken);
    
    const userTrades = trades.filter(t => 
      t.buyer === partyId || t.seller === partyId
    );

    if (limit) {
      return userTrades.slice(0, limit);
    }
    
    return userTrades;
  }

  /**
   * Execute immediate settlement for a match
   * This is the main entry point for the matching engine
   */
  async settleMatch(match, adminToken) {
    const { buyOrder, sellOrder, fillQuantity, fillPrice } = match;

    console.log(`[SettlementService] Settling match: ${fillQuantity} @ ${fillPrice}`);

    try {
      // Calculate amounts
      const baseAmount = fillQuantity;
      const quoteAmount = fillQuantity * fillPrice;

      // Extract trading pair info
      const [baseSymbol, quoteSymbol] = buyOrder.tradingPair.split('/');

      // Create settlement instruction
      const settlementResult = await this.createSettlementInstruction({
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

      // Get the settlement contract ID from result
      const settlementCid = settlementResult.events?.find(e => 
        e.created?.templateId?.entityName === 'SettlementInstruction'
      )?.created?.contractId;

      if (!settlementCid) {
        throw new Error('Failed to get settlement contract ID');
      }

      // Execute DvP
      const dvpResult = await this.executeSettlement(settlementCid, adminToken);

      // Extract trade info
      const tradeCid = dvpResult.events?.find(e => 
        e.created?.templateId?.entityName === 'Trade'
      )?.created?.contractId;

      console.log(`[SettlementService] Match settled, trade ID: ${tradeCid}`);

      return {
        success: true,
        tradeContractId: tradeCid,
        baseAmount,
        quoteAmount,
        price: fillPrice,
      };
    } catch (error) {
      console.error('[SettlementService] Match settlement failed:', error.message);
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
