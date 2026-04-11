/**
 * CENTRALIZED CONSTANTS - Frontend Single Source of Truth
 * 
 * ALL package IDs, party IDs, and important constants are defined here.
 * DO NOT hardcode these values anywhere else in the frontend.
 * 
 * To update any value:
 * 1. Update the value here
 * 2. Rebuild the frontend
 * 3. All components will automatically use the new value
 */

// =============================================================================
// PARTY IDS - Must match backend constants!
// =============================================================================

/**
 * Operator Party ID - The service account that manages the exchange
 */
export const OPERATOR_PARTY_ID = import.meta.env.VITE_OPERATOR_PARTY_ID || 
  'cardiv::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

// =============================================================================
// API ENDPOINTS
// =============================================================================

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

// =============================================================================
// PACKAGE IDS - Must match backend constants!
// =============================================================================

/**
 * Token Standard Package
 * Contains: Instrument, Holding, Settlement, Order, OrderV3
 * THIS IS THE ONLY PACKAGE ID — all old packages are retired.
 */
export const TOKEN_STANDARD_PACKAGE_ID = '5f41fdb377a25ceddc872dfdb6cd6b7dc02c35b0b536ba4253f6608cea4336f5';

// =============================================================================
// TRADING PAIRS
// =============================================================================

export const TRADING_PAIRS = [
  { pair: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
  { pair: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
  { pair: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT' },
];

// =============================================================================
// SUPPORTED TOKENS
// =============================================================================

export const SUPPORTED_TOKENS = {
  BTC: { symbol: 'BTC', name: 'Bitcoin', decimals: 8, icon: '₿' },
  USDT: { symbol: 'USDT', name: 'Tether USD', decimals: 6, icon: '₮' },
  ETH: { symbol: 'ETH', name: 'Ethereum', decimals: 18, icon: 'Ξ' },
  SOL: { symbol: 'SOL', name: 'Solana', decimals: 9, icon: '◎' },
  CC: { symbol: 'CC', name: 'Canton Coin', decimals: 8, icon: '◈' },
  CBTC: { symbol: 'CBTC', name: 'Canton BTC', decimals: 8, icon: '₵' },
  Amulet: { symbol: 'Amulet', name: 'Amulet (CC)', decimals: 10, icon: '♦' },
};

// =============================================================================
// DEFAULT MINT AMOUNTS - For test faucet
// =============================================================================

export const DEFAULT_MINT_AMOUNTS = {
  BTC: 10,
  USDT: 100000,
  ETH: 100,
  SOL: 1000,
  CC: 50,
  CBTC: 5,
  Amulet: 10,
};

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default {
  // Party IDs
  OPERATOR_PARTY_ID,
  
  // API
  API_BASE_URL,
  
  // Package IDs
  TOKEN_STANDARD_PACKAGE_ID,
  
  // Trading
  TRADING_PAIRS,
  SUPPORTED_TOKENS,
  DEFAULT_MINT_AMOUNTS,
};
