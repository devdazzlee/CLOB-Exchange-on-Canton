/**
 * Server-side Ed25519 signing utility.
 *
 * Used to auto-sign the Order Create transaction (step 2) on the backend
 * using the user's stored signing key, so the user only needs to sign once
 * (for the Allocation in step 1).
 *
 * The private key is stored encrypted in PostgreSQL via userRegistry.storeSigningKey().
 * It is the same key the frontend sends in signingKeyBase64 during step 1.
 */

let ed25519Module = null;
let sha512Module = null;

async function getEd25519() {
  if (!ed25519Module) {
    ed25519Module = require('@noble/ed25519');
    sha512Module = require('@noble/hashes/sha512');
    if (!ed25519Module.etc.sha512Sync) {
      ed25519Module.etc.sha512Sync = (...m) => sha512Module.sha512(ed25519Module.etc.concatBytes(...m));
    }
  }
  return ed25519Module;
}

/**
 * Sign a base64-encoded hash with a base64-encoded Ed25519 private key.
 *
 * @param {string} privateKeyBase64 - Ed25519 private key (32 bytes, base64)
 * @param {string} hashBase64 - Transaction hash to sign (base64)
 * @returns {Promise<string>} Signature as base64 string
 */
async function signHash(privateKeyBase64, hashBase64) {
  const ed = await getEd25519();
  const privateKey = Buffer.from(privateKeyBase64, 'base64');
  const hashBytes = Buffer.from(hashBase64, 'base64');
  const signature = await ed.sign(hashBytes, privateKey);
  return Buffer.from(signature).toString('base64');
}

module.exports = { signHash };
