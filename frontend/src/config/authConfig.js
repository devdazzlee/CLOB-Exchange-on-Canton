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
// Note: New Token Standard package (ac5e34e7...) uploaded but not vetted on synchronizer
// Using old package until Canton team vets new package
export const PACKAGE_ID = import.meta.env.VITE_PACKAGE_ID || 
  'dd500bf887d7e153ee6628b3f6722f234d3d62ce855572ff7ce73b7b3c2afefd';

export default {
  OPERATOR_PARTY_ID,
  API_BASE_URL,
  PACKAGE_ID
};
