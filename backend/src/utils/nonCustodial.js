/**
 * Non-custodial security: user private keys must only exist in the browser.
 * Backend accepts prepared-transaction hashes signed in-browser (signatureBase64 + signedBy only).
 */

const { ValidationError } = require('./errors');

/** Request body field names that must never carry key material to the API */
const PRIVATE_KEY_FIELD_NAMES = [
  'signingKeyBase64',
  'privateKey',
  'privateKeyBase64',
  'private_key',
  'encryptedPrivateKey',
  'mnemonic',
  'seed',
  'seedPhrase',
  'recoveryPhrase',
  'bip39',
];

function _isNonEmpty(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Throws ValidationError if the JSON body (or nested orderMeta/cancelMeta) contains key material.
 * @param {object} body - req.body
 * @param {string} [label] - for error messages
 */
function rejectPrivateKeyMaterialInBody(body, label = 'Request') {
  if (!body || typeof body !== 'object') return;

  const checkObj = (obj, path) => {
    if (!obj || typeof obj !== 'object') return;
    for (const field of PRIVATE_KEY_FIELD_NAMES) {
      if (Object.prototype.hasOwnProperty.call(obj, field) && _isNonEmpty(obj[field])) {
        throw new ValidationError(
          `${label}${path}: private key material must never be sent to the server. ` +
            'Sign in the browser and send signatureBase64 (and signedBy) only.'
        );
      }
    }
  };

  checkObj(body, '');
  for (const nest of ['orderMeta', 'cancelMeta']) {
    if (body[nest] && typeof body[nest] === 'object') {
      checkObj(body[nest], `.${nest}`);
    }
  }
}

module.exports = {
  rejectPrivateKeyMaterialInBody,
  PRIVATE_KEY_FIELD_NAMES,
};
