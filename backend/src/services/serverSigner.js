/**
 * Legacy server-side signer is intentionally disabled.
 * Non-custodial policy requires that user private keys remain in browser only.
 */
async function signHash() {
  throw new Error('Server-side signing is disabled in non-custodial mode.');
}

module.exports = { signHash };
