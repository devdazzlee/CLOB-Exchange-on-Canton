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

// Package ID for DAML contracts
// Old: dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd (existing contracts)
// New: f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454 (with token standard)
export const PACKAGE_ID = import.meta.env.VITE_PACKAGE_ID || 
  'dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd';

export default {
  OPERATOR_PARTY_ID,
  API_BASE_URL,
  PACKAGE_ID
};
