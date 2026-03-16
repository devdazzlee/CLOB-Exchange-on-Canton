# Client Flow vs Current Implementation — Gap Analysis

**Date:** 2026-03-14  
**Reference:** Client doc (Google Doc), ccview.io Transaction 1 & 2

---

## Client's Documented Flow (Token flow only between users)

### Transaction 1 — Order placement (user signs)
1. **Self-transfer** — Create exact-amount holding for the order
2. **Self-allocation** — Sender = Receiver = User (same party)
   - Purpose: Lock/reserve tokens for future settlement
   - **Not executed** — just created

### Transaction 2 — Settlement (app provider only)
1. **Withdraw** the Allocation — Unlock tokens locked in Transaction 1
2. **Create new allocation** — 2 transfer legs:
   - Leg 1: Seller → Buyer (base)
   - Leg 2: Buyer → Seller (quote)
3. **Execute** the allocation — Direct user-to-user transfer

**Result:** Tokens flow **only between users**. App provider never holds user assets.

---

## Our Current Implementation

### Order placement
- **Allocation:** sender=user, **receiver=operator**, executor=operator
- User signs once at order time
- Self-transfer skipped (Canton limitation: cannot combine self-transfer + allocation in one interactive submission)

### Settlement (operator-as-receiver)
1. Execute seller allocation (seller → **operator**)
2. Execute buyer allocation (buyer → **operator**)
3. Create allocation operator → buyer (base)
4. Create allocation operator → seller (quote)
5. Execute both operator legs

**Result:** Tokens flow **through the operator**. App provider temporarily holds user assets.

---

## Why We Use Operator-as-Receiver

We implemented the client's flow (withdraw + 2-leg allocation + execute) in `executeMultiLegSettlement()`. It fails with:

```
NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT
"This participant cannot submit as the given submitter on any connected synchronizer"
```

**Root cause:**
- `Allocation_Withdraw` — DAML controller is the **sender** (user). Requires user authorization.
- `AllocationFactory_Allocate` — Creating the new 2-leg allocation requires **sender** authorization for each leg (seller for base leg, buyer for quote leg).
- Our users are **external parties (ext-*)** — keys held in user wallet, not by the participant.
- The participant **cannot submit as ext-*** on any synchronizer. So we cannot perform Withdraw or Create at match time without user signing.

**Operator-as-receiver** avoids this: allocations at order placement use receiver=operator. At match time, the **executor** (operator) can exercise `Allocation_ExecuteTransfer` using only its own key — no ext-* submission needed.

---

## Questions for Client

1. **Party type in your working example**
   - Transaction 1 ccview shows party `0abdc5424637c362e7f4ac18d14af2b4` (no `ext-` prefix).
   - Are your users **hosted parties** (participant holds keys) or **external parties (ext-*)** (user holds keys in wallet)?
   - If hosted, the backend could submit as them for Withdraw/Create. If ext-*, we need a different pattern.

2. **"App provider solely" for Transaction 2**
   - How does the app provider perform Withdraw and Create without user signing?
   - Is there a DAML delegation pattern (app provider exercises on behalf of user)?
   - Or is your participant configured to submit as user parties (hosted setup)?

3. **Canton/Splice configuration**
   - Can you share the participant/synchronizer setup for the parties in your working Transaction 2?
   - PQS command references `wolfedgelabs-wallet::1220dd...` — is that a hosted party?

---

## What We Can Implement

| Component | Client flow | Our status |
|-----------|-------------|------------|
| Transaction 1: Self-transfer | Yes | Skipped (Canton: cannot combine with allocation in one interactive) |
| Transaction 1: Self-allocation | Yes (sender=receiver=user) | **Supported** in `buildAllocationInteractiveCommand` — we use receiver=operator instead |
| Transaction 2: Withdraw | Yes | Implemented in `withdrawAllocation()` — **fails** with NO_SYNCHRONIZER for ext-* |
| Transaction 2: Create 2-leg allocation | Yes | Implemented in `executeMultiLegSettlement()` — **fails** for same reason |
| Transaction 2: Execute | Yes | Would work if Withdraw + Create succeeded |

---

## Potential Solutions (Research Findings)

### 1. Splice DelegateProxy
- **DelegateProxy_Allocation_Withdraw** and **DelegateProxy_AllocationFactory_Allocate** — Controller: **delegate** (not sender).
- DelegateProxy is for app provider → delegate (operational party). The delegate can exercise these choices.
- **Caveat:** The underlying Allocation_Withdraw still requires sender authorization in the DAML contract. DelegateProxy is for when the provider/delegate operates on their own allocations, not user allocations. Needs verification with Huzaifa whether it can work for user→operator delegation.

### 2. Splice WalletUserProxy
- **WalletUserProxy_Allocation_Withdraw** — Controller: **user** (from proxyArg). User must still authorize.
- Purpose: Attribution when user performs actions. Does not allow provider to act on behalf of user.

### 3. Splice MergeDelegation
- User + operator both sign to create `MergeDelegation`. Then operator can run `MergeDelegation_Merge` alone.
- Pattern: Pre-authorization at onboarding. Splice has no equivalent `AllocationDelegation` for withdraw/create.

### 4. Hosted Parties (SPN)
- If users are **hosted parties** (Submitting Participant Node holds keys), the participant can submit as them unilaterally.
- **Action:** Ask client if they can use hosted parties or if their working example uses them. If yes, we switch to self-allocation + multi-leg settlement.

### 5. LockedAmulet / 0-Amount Artifacts
- Splice docs: "LockedAmulet is unlocked as part of executing Allocation_ExecuteTransfer."
- With operator-as-receiver, we execute allocations (drain amount) but Splice may leave 0-amount LockedAmulet contracts until expiry.
- **Client's flow (withdraw + 2-leg)** would fully consume allocations via Withdraw — no LockedAmulet leftovers. Switching to client flow would fix this.

---

## What We Can Implement Now

| Solution | Action | Blocked By |
|----------|--------|------------|
| Self-allocation at order placement | Change `receiverPartyId` from operator to user in `tryBuildRealAllocationCommand` | None — can implement. But settlement would then need withdraw, which fails for ext-* |
| Self-transfer + self-allocation (2-step) | Add optional self-transfer step before allocation (user signs twice) | None — improves exact-amount holding |
| DelegateProxy for withdraw | Investigate if DelegateProxy can withdraw user allocations | Need Huzaifa confirmation |
| Hosted parties | Switch to client flow | Client must confirm their setup uses hosted parties |

---

## Implementation (TradingApp Pattern)

**Implemented 2026-03-14.** Set `USE_TRADING_APP_PATTERN=true` in `.env` to enable.

### Flow
1. **Order placement:** Self-allocation (sender=receiver=user) when flag is true.
2. **Match:** Creates `PendingSettlement` instead of immediate settlement. Both parties receive WebSocket `PENDING_SIGNATURE`.
3. **Settlement (both parties sign):**
   - Each party: `POST /api/settlement/:matchId/prepare-withdraw` → sign → `POST /api/settlement/:matchId/submit-withdraw`
   - When both withdrawn: `POST /api/settlement/:matchId/prepare-multileg` → both sign → `POST /api/settlement/:matchId/submit-multileg-signature` (each party)
   - When both multi-leg signatures received: backend auto-executes allocation, FillOrder, broadcast.

### APIs
- `GET /api/settlement/pending?partyId=...` — List pending settlements for party
- `POST /api/settlement/:matchId/prepare-withdraw` — Prepare withdraw (X-Party-Id, token)
- `POST /api/settlement/:matchId/submit-withdraw` — Submit signed withdraw
- `POST /api/settlement/:matchId/prepare-multileg` — Prepare multi-leg allocation (idempotent)
- `POST /api/settlement/:matchId/submit-multileg-signature` — Add party's multi-leg signature

### UI
- **Pending Settlements** card in Trading Interface — lists pending trades requiring signature
- **Sign Withdraw** — prepare → sign with wallet → submit (each party)
- **Sign Multi-Leg** — prepare (once) → both parties sign → auto-execute
- WebSocket `settlement:${partyId}` for real-time PENDING_SIGNATURE notifications

### Migration
Run `npx prisma migrate dev --name add_pending_settlement` to create the `PendingSettlement` table.

---

## Recommended Next Steps

1. **Client to confirm:** Party type (hosted vs ext-*) and how "app provider solely" works in their setup.
2. **If hosted parties:** We can switch to self-allocation + multi-leg settlement. Tokens would flow only between users; lock artifacts would be resolved.
3. **If ext-* parties:** Escalate to Huzaifa:
   - Can DelegateProxy be used for operator to withdraw user allocations?
   - Is there an AllocationDelegation or similar pattern (like MergeDelegation) for CLOB settlement?
4. **Short-term:** Implement self-allocation at order placement (optional) so we're ready when settlement path is unblocked. Keep operator-as-receiver as fallback.

---

## References

- Client doc: https://docs.google.com/document/d/1aD_Gt63xW77LuT3RXGzIMPHNqJrb4varXaQiEKKLjgY/edit
- Transaction 1 (self-transfer): https://ccview.io/updates/12206ca53e129973bff08998084e86a946eb3240927b846e526a9d2d717741147264/
- Transaction 2 (withdraw + 2-leg + execute): https://ccview.io/updates/12200638594fa81c6b62bd0da0f2b3a3394429692eb853d14946372922557b098db0/ (Events 218-237)
- Huzaifa questions: `backend/docs/HUZAIFA_QUESTIONS.md`
- Splice TradingApp: https://github.com/hyperledger-labs/splice/blob/bca52d362f8243369381b32aa16279e5b0ebafdf/token-standard/examples/splice-token-test-trading-app/daml/Splice/Testing/Apps/TradingApp.daml
