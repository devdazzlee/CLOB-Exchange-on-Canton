/**
 * Auth Configuration
 * Contains operator and authentication related config
 * 
 * ALL VALUES IMPORTED FROM CENTRALIZED CONSTANTS
 */

// Import ALL from centralized constants - SINGLE SOURCE OF TRUTH
import { 
  OPERATOR_PARTY_ID, 
  API_BASE_URL,
  TOKEN_STANDARD_PACKAGE_ID, 
  LEGACY_PACKAGE_ID 
} from './constants';

// Re-export everything from constants
export { OPERATOR_PARTY_ID, API_BASE_URL, LEGACY_PACKAGE_ID };

// Package ID for DAML contracts - from centralized constants
export const PACKAGE_ID = import.meta.env.VITE_PACKAGE_ID || TOKEN_STANDARD_PACKAGE_ID;

export default {
  OPERATOR_PARTY_ID,
  API_BASE_URL,
  PACKAGE_ID,
  LEGACY_PACKAGE_ID
};
