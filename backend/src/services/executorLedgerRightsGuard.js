/**
 * Verifies the executor (Cardiv) OAuth identity has the minimum ledger rights for
 * interactive prepare(TransferInstruction_Accept) with readAs = [receiver, operator].
 *
 * grantExecutorRightsToAllParties (gRPC) grants both CanActAs and CanReadAs per party.
 * If operator grant failed (e.g. domain party), prepare may still fail — this check
 * surfaces misconfiguration at startup instead of on every transfer.
 */

const config = require('../config');
const tokenProvider = require('./tokenProvider');
const cantonService = require('./cantonService');
const decodeTokenPayload = require('./cantonService').decodeTokenPayload;

class ExecutorLedgerRightsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExecutorLedgerRightsError';
    this.code = 'EXECUTOR_LEDGER_RIGHTS';
  }
}

/**
 * Call after grantExecutorRightsToAllParties() so rights are present before Auto-Accept.
 * @throws {ExecutorLedgerRightsError}
 */
async function assertExecutorReadyForTransferInstructionAccept() {
  const operatorPartyId = config.canton.operatorPartyId;
  if (!operatorPartyId) {
    throw new ExecutorLedgerRightsError('OPERATOR_PARTY_ID is required');
  }

  let token;
  try {
    token = await tokenProvider.getExecutorToken();
  } catch (e) {
    throw new ExecutorLedgerRightsError(
      `Cannot obtain executor token (EXECUTOR_* OAuth). Fix Keycloak client credentials. ${e.message}`
    );
  }

  let sub;
  try {
    sub = decodeTokenPayload(token).sub;
  } catch (e) {
    throw new ExecutorLedgerRightsError(`Executor JWT has no usable sub: ${e.message}`);
  }

  let raw;
  try {
    raw = await cantonService.getUserRights(token, sub);
  } catch (e) {
    throw new ExecutorLedgerRightsError(
      `Cannot read ledger user rights for executor (sub=${sub}). ` +
        `Ensure the executor client may call GET /v2/users/{userId}/rights. ${e.message}`
    );
  }

  const rights = cantonService.parseUserRights(raw);
  const canRead = new Set(rights.canReadAs || []);

  if (!canRead.has(operatorPartyId)) {
    throw new ExecutorLedgerRightsError(
      `Executor ledger user (${sub}) must have CanReadAs for OPERATOR_PARTY_ID so ` +
        `interactive prepare can include the operator in readAs. ` +
        `Grant via gRPC GrantUserRights or JSON API (see onboarding grantExecutorRightsToAllParties). ` +
        `If your operator is a non-grantable domain party, your validator must still expose ` +
        `equivalent visibility to this user — otherwise TransferInstruction prepare will fail. ` +
        `Missing CanReadAs: ${operatorPartyId}`
    );
  }

  return { executorUserId: sub, operatorPartyId, rights };
}

module.exports = {
  assertExecutorReadyForTransferInstructionAccept,
  ExecutorLedgerRightsError,
};
