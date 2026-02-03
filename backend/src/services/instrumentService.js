/**
 * Instrument Service - Manages token type definitions
 * 
 * Instruments define token types (like ERC-20 metadata):
 * - Symbol (e.g., "cBTC", "USDT")
 * - Decimals (e.g., 8 for BTC, 6 for USDT)
 * - Issuer (who created/manages the token)
 * 
 * Each token type has one Instrument contract.
 * Holdings reference Instruments via instrumentId.
 */

const cantonService = require('./cantonService');
const config = require('../config');

// Template IDs
const getTemplateIds = () => {
  const packageId = config.packageId || process.env.CLOB_EXCHANGE_PACKAGE_ID;
  return {
    instrument: `${packageId}:Instrument:Instrument`,
    tradingPair: `${packageId}:Instrument:TradingPair`,
  };
};

// Standard instruments we support
const STANDARD_INSTRUMENTS = {
  cBTC: { symbol: 'cBTC', description: 'Canton-wrapped Bitcoin', decimals: 8 },
  BTC: { symbol: 'BTC', description: 'Bitcoin (legacy)', decimals: 8 },
  USDT: { symbol: 'USDT', description: 'Tether USD Stablecoin', decimals: 6 },
  ETH: { symbol: 'ETH', description: 'Ethereum', decimals: 18 },
  SOL: { symbol: 'SOL', description: 'Solana', decimals: 9 },
};

// Standard trading pairs
const STANDARD_PAIRS = [
  { base: 'cBTC', quote: 'USDT', minOrderSize: '0.0001', tickSize: '0.01' },
  { base: 'BTC', quote: 'USDT', minOrderSize: '0.0001', tickSize: '0.01' },
  { base: 'ETH', quote: 'USDT', minOrderSize: '0.001', tickSize: '0.01' },
  { base: 'SOL', quote: 'USDT', minOrderSize: '0.1', tickSize: '0.001' },
];

class InstrumentService {
  constructor() {
    this.cantonService = null;
    this.instrumentCache = new Map(); // Cache instrument contracts
  }

  async initialize() {
    this.cantonService = cantonService;
    console.log('[InstrumentService] Initialized');
  }

  /**
   * Create an Instrument contract (defines a token type)
   */
  async createInstrument(symbol, description, decimals, observers, adminToken) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;
    const synchronizerId = config.synchronizerId || process.env.DEFAULT_SYNCHRONIZER_ID;

    try {
      const instrumentId = {
        issuer: operatorPartyId,
        symbol: symbol,
        version: '1.0',
      };

      console.log(`[InstrumentService] Creating instrument ${symbol} with template: ${templateIds.instrument}`);
      console.log(`[InstrumentService] Using synchronizerId: ${synchronizerId?.substring(0, 30)}...`);

      const result = await cantonService.createContractWithTransaction({
        token: adminToken,
        actAsParty: operatorPartyId,
        templateId: templateIds.instrument,
        createArguments: {
          instrumentId: instrumentId,
          description: description,
          decimals: decimals,
          observers: observers || [],
        },
        readAs: [operatorPartyId],
        synchronizerId: synchronizerId,
      });

      console.log(`[InstrumentService] Created instrument: ${symbol}`);
      
      // Extract contract ID from result
      const contractId = result.transaction?.events?.[0]?.created?.contractId;
      
      // Update cache
      this.instrumentCache.set(symbol, {
        contractId: contractId,
        instrumentId,
        description,
        decimals,
      });

      return result;
    } catch (error) {
      console.error(`[InstrumentService] Failed to create instrument ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a TradingPair contract
   */
  async createTradingPair(baseSymbol, quoteSymbol, minOrderSize, tickSize, adminToken) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;
    const synchronizerId = config.synchronizerId || process.env.DEFAULT_SYNCHRONIZER_ID;

    try {
      const pairId = `${baseSymbol}/${quoteSymbol}`;
      
      console.log(`[InstrumentService] Creating trading pair ${pairId} with template: ${templateIds.tradingPair}`);
      
      const result = await cantonService.createContractWithTransaction({
        token: adminToken,
        actAsParty: operatorPartyId,
        templateId: templateIds.tradingPair,
        createArguments: {
          operator: operatorPartyId,
          baseInstrument: {
            issuer: operatorPartyId,
            symbol: baseSymbol,
            version: '1.0',
          },
          quoteInstrument: {
            issuer: operatorPartyId,
            symbol: quoteSymbol,
            version: '1.0',
          },
          minOrderSize: minOrderSize,
          tickSize: tickSize,
          enabled: true,
          observers: [],
          pairId: pairId,
        },
        readAs: [operatorPartyId],
        synchronizerId: synchronizerId,
      });

      console.log(`[InstrumentService] Created trading pair: ${pairId}`);
      return result;
    } catch (error) {
      console.error(`[InstrumentService] Failed to create trading pair:`, error.message);
      throw error;
    }
  }

  /**
   * Get all Instruments
   */
  async getInstruments(token) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const instruments = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [templateIds.instrument],
      }, token);

      return instruments.map(i => ({
        contractId: i.contractId,
        symbol: i.payload.instrumentId?.symbol,
        description: i.payload.description,
        decimals: i.payload.decimals,
        issuer: i.payload.instrumentId?.issuer,
        version: i.payload.instrumentId?.version,
      }));
    } catch (error) {
      console.error('[InstrumentService] Failed to get instruments:', error.message);
      throw error;
    }
  }

  /**
   * Get all TradingPairs
   */
  async getTradingPairs(token) {
    const templateIds = getTemplateIds();
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      const pairs = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [templateIds.tradingPair],
      }, token);

      return pairs.map(p => ({
        contractId: p.contractId,
        pairId: p.payload.pairId,
        baseSymbol: p.payload.baseInstrument?.symbol,
        quoteSymbol: p.payload.quoteInstrument?.symbol,
        minOrderSize: p.payload.minOrderSize,
        tickSize: p.payload.tickSize,
        enabled: p.payload.enabled,
      }));
    } catch (error) {
      console.error('[InstrumentService] Failed to get trading pairs:', error.message);
      throw error;
    }
  }

  /**
   * Bootstrap standard instruments and pairs
   */
  async bootstrapStandard(adminToken) {
    console.log('[InstrumentService] Bootstrapping standard instruments and pairs...');

    // Create instruments
    for (const [symbol, info] of Object.entries(STANDARD_INSTRUMENTS)) {
      try {
        await this.createInstrument(symbol, info.description, info.decimals, [], adminToken);
        console.log(`[InstrumentService] Created instrument: ${symbol}`);
      } catch (error) {
        if (error.message?.includes('ALREADY_EXISTS') || error.message?.includes('duplicate')) {
          console.log(`[InstrumentService] Instrument ${symbol} already exists`);
        } else {
          console.warn(`[InstrumentService] Failed to create ${symbol}:`, error.message);
        }
      }
    }

    // Create trading pairs
    for (const pair of STANDARD_PAIRS) {
      try {
        await this.createTradingPair(pair.base, pair.quote, pair.minOrderSize, pair.tickSize, adminToken);
        console.log(`[InstrumentService] Created pair: ${pair.base}/${pair.quote}`);
      } catch (error) {
        if (error.message?.includes('ALREADY_EXISTS') || error.message?.includes('duplicate')) {
          console.log(`[InstrumentService] Pair ${pair.base}/${pair.quote} already exists`);
        } else {
          console.warn(`[InstrumentService] Failed to create pair:`, error.message);
        }
      }
    }

    console.log('[InstrumentService] Bootstrap complete');
  }

  /**
   * Get instrument ID for a symbol
   */
  getInstrumentId(symbol) {
    const operatorPartyId = config.operatorPartyId || process.env.OPERATOR_PARTY_ID;
    return {
      issuer: operatorPartyId,
      symbol: symbol,
      version: '1.0',
    };
  }
}

// Singleton
let instrumentServiceInstance = null;

function getInstrumentService() {
  if (!instrumentServiceInstance) {
    instrumentServiceInstance = new InstrumentService();
  }
  return instrumentServiceInstance;
}

module.exports = {
  InstrumentService,
  getInstrumentService,
  STANDARD_INSTRUMENTS,
  STANDARD_PAIRS,
};
