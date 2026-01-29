/**
 * Template ID Helper
 * 
 * Creates properly formatted template IDs for Canton JSON Ledger API v2
 * Uses package-id format: "<packageId>:<module>:<entity>"
 */

const config = require('../config');

/**
 * Create a template ID in the correct format
 * @param {string} pkgId - Package ID (from DAR extraction)
 * @param {string} moduleName - Module name 
 * @param {string} entityName - Entity name
 * @returns {string} Formatted template ID
 */
function templateId(pkgId, moduleName, entityName) {
  if (!pkgId) {
    throw new Error('Package ID is required for template ID creation. Set CLOB_EXCHANGE_PACKAGE_ID environment variable.');
  }
  
  if (!moduleName || !entityName) {
    throw new Error('Module name and entity name are required for template ID creation.');
  }
  
  return `${pkgId}:${moduleName}:${entityName}`;
}

/**
 * Get the configured package ID for CLOB Exchange
 * @returns {string} Package ID
 */
function getClobExchangePackageId() {
  return config.canton.validatePackageId();
}

/**
 * Create UserAccount template ID
 * @returns {string} UserAccount template ID
 */
function userAccountTemplateId() {
  const pkgId = getClobExchangePackageId();
  return templateId(pkgId, 'UserAccount', 'UserAccount');
}

/**
 * Create Order template ID
 * @returns {string} Order template ID
 */
function orderTemplateId() {
  const pkgId = getClobExchangePackageId();
  return templateId(pkgId, 'Order', 'Order');
}

/**
 * Create Trade template ID
 * @returns {string} Trade template ID
 */
function tradeTemplateId() {
  const pkgId = getClobExchangePackageId();
  return templateId(pkgId, 'Trade', 'Trade');
}

/**
 * Create Balance template ID
 * @returns {string} Balance template ID
 */
function balanceTemplateId() {
  const pkgId = getClobExchangePackageId();
  return templateId(pkgId, 'Balance', 'Balance');
}

module.exports = {
  templateId,
  getClobExchangePackageId,
  userAccountTemplateId,
  orderTemplateId,
  tradeTemplateId,
  balanceTemplateId
};
