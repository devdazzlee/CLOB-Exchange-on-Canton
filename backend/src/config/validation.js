/**
 * Environment Configuration Validation - FIXED VERSION
 * Enforces all required variables - NO FALLBACKS
 */

const config = require('./index');

class ConfigValidator {
  static validate() {
    const errors = [];

    // Validate Canton configuration
    if (!config.canton.jsonApiBase) {
      errors.push('CANTON_JSON_LEDGER_API_BASE is required');
    }

    if (!config.canton.oauth.tokenUrl) {
      errors.push('KEYCLOAK_TOKEN_URL is required');
    }

    if (!config.canton.oauth.clientId) {
      errors.push('OAUTH_CLIENT_ID is required');
    }

    if (!config.canton.oauth.clientSecret) {
      errors.push('OAUTH_CLIENT_SECRET is required');
    }

    if (!config.canton.operatorPartyId) {
      errors.push('OPERATOR_PARTY_ID is required');
    }

    // Validate package name (not package IDs)
    if (!config.canton.packageName) {
      errors.push('PACKAGE_NAME is required');
    }

    if (errors.length > 0) {
      console.error('\n❌ CONFIGURATION VALIDATION FAILED');
      console.error('\nMissing required environment variables:');
      errors.forEach(error => console.error(`  - ${error}`));
      console.error('\nPlease check your .env file and ensure all required variables are set.');
      console.error('See .env.example for reference.\n');
      process.exit(1);
    }

    console.log('✅ Configuration validation passed');
    return true;
  }

  static validateCantonConnection() {
    // Test Canton connection
    if (!config.canton.jsonApiBase.startsWith('http')) {
      throw new Error('CANTON_JSON_LEDGER_API_BASE must be a valid URL');
    }

    // Validate party ID format
    if (!config.canton.operatorPartyId.includes('::')) {
      throw new Error('OPERATOR_PARTY_ID must be in format: prefix::hex');
    }

    // Validate package name format
    if (!config.canton.packageName || !config.canton.packageName.includes('-')) {
      console.warn('PACKAGE_NAME should be the DAML package name, e.g. "clob-exchange"');
    }

    console.log('✅ Canton connection validation passed');
    return true;
  }
}

module.exports = ConfigValidator;
