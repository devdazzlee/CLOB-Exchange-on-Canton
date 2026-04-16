# Client 4/14/2026 requirements — verification checklist

Use this list to sign off against the messages in `docs/clientchat.txt` (placement/settlement signers, keys, partials, stop-loss, 1+1 txs, `/store-signing-key`).

## 1. Non-custodial keys (never store private keys in DB)

- [ ] Deploy DB migration `20260415120000_drop_signing_key_table` (drops `SigningKey` table).
- [ ] Confirm no API accepts `signingKeyBase64` on order/onboarding routes (backend rejects with validation error).
- [ ] Confirm `/api/onboarding/store-signing-key` is not registered.
- [ ] Network tab: order placement sends `signatureBase64` + `signedBy`, not raw private key material.

## 2. Placement transaction signed by user `partyId`

- [ ] Canton explorer (or ledger): placement update shows user party as submitter / `actAs` as appropriate for your topology.
- [ ] One **ledger** transaction for the placement flow you test (single `updateId` for the placement bundle).

## 3. Settlement transaction signed by app provider `partyId`

- [ ] Explorer: settlement/match update shows **provider/operator** party as submitter.
- [ ] One **ledger** transaction per match for the settlement path under test.

## 4. Partial orders

- [ ] Place two orders that partially cross; confirm remaining quantity stays on book until fully filled.
- [ ] No premature “filled” / eviction until remainder is zero.

## 5. Stop-loss

- [ ] Register stop-loss only after placement is committed.
- [ ] Trigger fires at threshold; `TriggerStopLoss` failure does not mark success in DB.

## 6. Optional: broader chat themes (not only 4/14 bullets)

- [ ] Allocations are **executed** at settlement, not only created (see chat ~1020–1024).
- [ ] Real CC/CBTC movement via Token Standard / allocation flow where applicable.

## Notes

- “One transaction” may be one Canton **update** containing **multiple commands** in a single `commands` array — still counts as one ledger transaction if the participant accepts it.
- If interactive **multi-command** prepare fails on your participant, record the error and adjust DAML/API split — environment-specific.
