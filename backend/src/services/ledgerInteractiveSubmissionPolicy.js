/**
 * Ledger policy for interactive TransferInstruction_Accept (external user signs).
 *
 * Root cause this encodes:
 * - Prepare runs as the OAuth user behind EXECUTOR_CLIENT_ID (Cardiv). Canton only allows
 *   parties in actAs/readAs that appear in that user's ledger rights (CanActAs / CanReadAs).
 * - The receiver must be the sole actAs party (they hold the Ed25519 key that signs).
 * - Splice TransferInstruction visibility for the submitting user requires the exchange
 *   operator in readAs so the participant can resolve the contract + disclosed state.
 *
 * Do not add instrument registrar, DSO, or other infra parties to readAs unless your
 * Keycloak user has been explicitly granted CanReadAs for them — otherwise Canton returns
 * HTTP 403 with "A security-sensitive error has been received" (permission denied).
 *
 * Synchronizer for the submission is chosen separately (contract synchronizer or
 * resolveSubmissionSynchronizerId) — that is topology alignment, not authorization.
 */

function assertLedgerPartyId(label, partyId) {
  if (!partyId || typeof partyId !== 'string' || !partyId.includes('::')) {
    throw new Error(`${label} must be a full Canton party id (prefix::fingerprint)`);
  }
}

/**
 * actAs for TransferInstruction_Accept — only the receiver authorizes the exercise.
 * @param {string} receiverPartyId
 * @returns {string[]}
 */
function transferInstructionAcceptActAs(receiverPartyId) {
  assertLedgerPartyId('receiverPartyId', receiverPartyId);
  return [receiverPartyId];
}

/**
 * readAs for TransferInstruction_Accept under the executor token.
 * Exactly receiver + operator — matches onboarding gRPC grants (CanReadAs for both).
 * @param {string} receiverPartyId
 * @param {string} operatorPartyId
 * @returns {string[]}
 */
function transferInstructionAcceptReadAs(receiverPartyId, operatorPartyId) {
  assertLedgerPartyId('receiverPartyId', receiverPartyId);
  assertLedgerPartyId('operatorPartyId', operatorPartyId);
  return [...new Set([receiverPartyId, operatorPartyId])];
}

module.exports = {
  transferInstructionAcceptActAs,
  transferInstructionAcceptReadAs,
};
