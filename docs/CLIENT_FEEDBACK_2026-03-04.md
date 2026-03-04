# Client Feedback — 4 March 2026

## Client reported (backend on Railway, frontend on Vercel):

1. **Allocations are still not being executed** — only created
2. **Users must sign twice** to place an order — should be single sign
3. **Tokens are not locked** while placing an order

---

## Root Causes & Fixes — ALL COMPLETE

### Issue 1: "Allocations created but not executed"

**Root cause:** The matching engine was **disabled by default** (`MATCHING_ENGINE_ENABLED` had to be set to `'true'` explicitly). On Railway (persistent server), the matching engine background loop never started, so `Allocation_ExecuteTransfer` was never called after orders were matched.

Additionally, the event-driven matching path (StreamingReadModel → `orderCreated` → `triggerMatchingCycle`) only fires if the streaming read model initializes successfully. If it doesn't, there's no matching at all.

**Fixes:**
1. **`backend/src/config/index.js`** — Matching engine is now **ENABLED by default**. Set `MATCHING_ENGINE_ENABLED=false` to disable.
2. **`backend/src/controllers/orderController.js`** — After every successful `execute-place`, a non-blocking `setTimeout(3s)` triggers `triggerMatchingCycle()` as a safety net, ensuring allocation execution even if the event-driven path is slow.
3. **`frontend/src/components/TradingInterface.jsx`** — After order placement success, frontend calls `POST /api/match/trigger` at 4s as a third safety net.
4. **`backend/src/services/matching-engine.js`** — Explicitly rejects `#0` (single-sign relative reference) as invalid `allocationCid` and uses DB fallback (`getAllocationContractIdForOrder`).
5. **`backend/src/services/order-service.js`** — In `executeOrderPlacement`, if Canton's execute response doesn't include the allocation CID in events, the code actively searches for it via `_findAllocationCidForOrder()` and stores it in DB. The matching engine can then find it.

### Issue 2: "Users have to sign twice"

**Root cause:** Two bugs:
1. The backend prepared allocation and order create as **two separate transactions**, requiring two signatures.
2. `/api/orders/place` response was missing `stage` field, so frontend defaulted to `'ALLOCATION_PREPARED'` (legacy 2-step path).

**Fixes:**
1. **`backend/src/services/order-service.js`** — `placeOrder()` now sends BOTH commands in ONE `prepareInteractiveSubmission` call:
   - Command 1: `AllocationFactory_Allocate` (locks tokens, creates allocation)
   - Command 2: `CreateCommand Order` with `allocationCid: '#0'` (text ref to allocation)
   - Stage: `ALLOCATION_AND_ORDER_PREPARED` — one sign, then done.
2. **`backend/src/controllers/orderController.js`** — Returns `stage`, `step`, `allocationType` in the response.
3. **`backend/src/services/order-service.js`** — `executeOrderPlacement()` detects `ALLOCATION_AND_ORDER_PREPARED` and skips the second prepare, going directly to success.

### Issue 3: "Tokens not locked in UI"

**Root cause:** Backend Balance V2 API returns `reserved` (amounts locked in open orders) separately from `locked`. Frontend `balanceService.js` only passed `locked` through, dropping the `reserved` field. The BalanceCard component never received the lock amounts.

**Fixes:**
1. **`frontend/src/services/balanceService.js`** — Merges `reserved` into `locked` so total lock state surfaces in UI.
2. **`frontend/src/components/trading/BalanceCard.jsx`** — Already renders lock icon + amount when `lockedBalance > 0` (no change needed).

### Issue 4: Cancel path with `#0` (preventive)

With single-sign, the on-chain Order stores `allocationCid: '#0'`. Cancel flow now rejects `#` prefixed CIDs and uses `getAllocationContractIdForOrder()` from DB instead.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/config/index.js` | Matching engine **enabled by default** |
| `backend/src/app.js` | Fix log message for matching engine env var |
| `backend/src/services/order-service.js` | Single-sign (2 commands in 1 prepare), active allocationCid search after execute, cancel `#0` fix |
| `backend/src/controllers/orderController.js` | Return `stage`/`step`/`allocationType`, non-blocking match trigger |
| `backend/src/services/matching-engine.js` | Reject `#` prefix allocationCid, use DB fallback |
| `frontend/src/services/balanceService.js` | Merge `reserved` into `locked` |
| `frontend/src/components/TradingInterface.jsx` | Frontend match trigger after placement |

---

### Issue 5: "Insufficient CC balance" when user has CC

**Root cause:** `OrderForm.jsx` subtracted `lockedBalance` from `balance` to compute available funds, but `balance` already represents the API's `available` (which has reservations pre-subtracted by the backend). This double-subtraction caused `available - locked = 0` even when the user had genuine available funds.

**Fix:**
1. **`frontend/src/components/trading/OrderForm.jsx`** — Removed the `lockedBalance` subtraction. `baseBalance` and `quoteBalance` now use `balance[token]` directly (= available from backend).

### Issue 6: Wallet logout fails to clear stale state

**Root cause:** `handleLogout()` in `App.jsx` only cleared `canton_wallet` and `canton_party_id`, but left behind stale `accessToken`, `canton_session_token`, `canton_key_fingerprint`, `refreshToken`, `partyId`, and `canton_signing_key_b64` (sessionStorage). When creating a new wallet, the `apiClient` interceptor sent the old `accessToken`/`canton_session_token` as Authorization headers, causing backend rejections.

**Fix:**
1. **`frontend/src/App.jsx`** — `handleLogout()` now clears ALL wallet/auth/session keys: `clearWallet()`, `clearStoredSession()`, `authService.logout()`, plus legacy `accessToken`, `refreshToken`, `partyId`, and sessionStorage `canton_signing_key_b64`.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/config/index.js` | Matching engine **enabled by default** |
| `backend/src/app.js` | Fix log message for matching engine env var |
| `backend/src/services/order-service.js` | Single-sign (2 commands in 1 prepare), active allocationCid search after execute, cancel `#0` fix |
| `backend/src/controllers/orderController.js` | Return `stage`/`step`/`allocationType`, non-blocking match trigger |
| `backend/src/services/matching-engine.js` | Reject `#` prefix allocationCid, use DB fallback |
| `frontend/src/services/balanceService.js` | Merge `reserved` into `locked` |
| `frontend/src/components/TradingInterface.jsx` | Frontend match trigger after placement |
| `frontend/src/components/trading/OrderForm.jsx` | Fix double-subtraction of locked balance |
| `frontend/src/App.jsx` | Full cleanup of all localStorage/sessionStorage on logout |

---

## Verification After Deploy

Test with **fresh wallet** (clear cache):

1. **Mint tokens** (CC and/or CBTC)
2. **Place a BUY order** → should ask for **ONE signature only** (no "Step 1 complete" toast)
3. **Check balance** → should show lock icon with reserved amount next to token
4. **Check "Insufficient balance"** → if balance shows 1.00 CC available, selling 1.00 CC should be allowed (no false "Insufficient" error)
5. **Place a matching SELL order** from second wallet → allocation execution should fire within ~5 seconds
6. **Check backend logs** → should see `Allocation_ExecuteTransfer succeeded` for both buyer and seller
7. **Check balances after trade** → locked clears, trade balances update
8. **Test wallet logout + create new** → logout, then create new wallet. Should work without manually clearing localStorage
