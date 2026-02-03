/**
 * Auth Configuration
 * Contains operator and authentication related config
 */

// Operator Party ID - the service account that manages the exchange
export const OPERATOR_PARTY_ID = import.meta.env.VITE_OPERATOR_PARTY_ID || 
  '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

// API Base URL
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

// Package ID for DAML contracts (Token Standard - clob-token-standard v1.0.0)
// Successfully vetted and deployed: BTC, USDT, ETH, SOL, cBTC instruments created
export const PACKAGE_ID = import.meta.env.VITE_PACKAGE_ID || 
  '813a7f5a2d053bb8e408035cf0a7f86d216f62b216eb6a6e157b253d0d2ccb69';

// Legacy package for backward compatibility (UserAccount, Order, etc.)
export const LEGACY_PACKAGE_ID = 'dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd';

export default {
  OPERATOR_PARTY_ID,
  API_BASE_URL,
  PACKAGE_ID,
  LEGACY_PACKAGE_ID
};
