# Client Requirements Compliance Report

**Date:** 2026-03-28  
**Source:** `backend/docs/clientchat.txt` (full chat history)

---

## 1. Token Flow & App Provider Jurisdiction

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **App provider must NOT have jurisdiction over user assets** | "the app provider should not have jurisdiction of user's asset in anyway" | ✅ Met (TradingApp) | When `USE_TRADING_APP_PATTERN=true`: tokens flow only between users |
| **Flow of token should only be between users, not to app provider** | Same | ✅ Met (TradingApp) | Withdraw → 2-leg (seller→buyer, buyer→seller) → execute |
| **Refer to client doc** | https://docs.google.com/document/d/1aD_Gt63xW77LuT3RXGzIMPHNqJrb4varXaQiEKKLjgY/edit | ✅ Aligned | Self-allocation, withdraw, 2-leg, execute |

---

## 2. Operator Signing Key

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Never expose or use raw private keys of the operator** | "We can never expose or use raw private keys of the operator in anyway in any app" | ✅ Met | No operator key stored or used |
| **All operator signing key logic removed** | "All operator signing key logic has been removed" | ✅ Met | SigningKey table stores USER keys only |
| **No orphaned allocation cleanup using operator key** | "No more orphaned allocation cleanup or scripts that use it" | ✅ Met | ACS cleanup archives orders/trades; no operator key involved |

---

## 3. Lock After Settlement

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **No net locked holding contracts after settlement** | Huzaifa: "create an AllocationRequest with 2 transfer-legs partyA->partyB and partyB->partyA and execute... no net locked holding contracts" | ✅ Met (TradingApp) | 2-leg allocation + execute = no LockedAmulet |
| **Allocation_ExecuteTransfer consumes the Lock** | Huzaifa: "The Allocation_ExecuteTransfer choice does consumes the Lock contract" | ✅ Met | TradingApp flow uses this |
| **TradingApp example** | https://github.com/hyperledger-labs/splice/blob/.../TradingApp.daml | ✅ Implemented | Same pattern: withdraw, 2-leg, execute |

---

## 4. Allocations (Not TransferInstruction)

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Use Allocations for settlement** | "we need to use Allocations... settle (using the executor) the allocation when there is matching order" | ✅ Met | Allocation-based settlement |
| **NOT TransferInstruction** | "the transfer of assets is done by TransferInstruction which should not be the case" | ✅ Met | We use Allocation API only |
| **Create at order placement, execute at match** | "we can set sender, receiver and executor beforehand" | ✅ Met | Allocation created at order, executed at match (or withdrawn+2-leg in TradingApp) |

---

## 5. Token Locking at Order Placement

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Lock tokens when order is placed** | "Token locking at the time an order is placed. Locking ensures that the tokens are reserved for that specific order" | ✅ Met | OrderReservation + Allocation lock |
| **Self-allocation (lock for future settlement)** | Client doc Transaction 1 | ✅ Met (TradingApp) | sender=receiver=user when flag true |

---

## 6. External Parties

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **External parties (ext-*)** | "we need to shift to external parties" | ✅ Met | Users are ext-* parties |
| **User's private key for authorization** | "every transaction submitted will require signature from this private key" | ✅ Met | Interactive signing for orders, withdraw, multi-leg |

---

## 7. Match Making

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Order fulfilment (partial or full)** | "match making which included order fulfilment(partial or full)" | ✅ Met | Partial fills supported |
| **Order cancellation** | Same | ✅ Met | CancelOrder flow |
| **Real transfer of tokens** | Same | ✅ Met | Allocation_ExecuteTransfer (or 2-leg in TradingApp) |
| **Visible on explorer** | "We can't see any transfer of tokens on explorer" | ✅ Met | Splice token standard; CC/CBTC transfers visible on ccview |

---

## 8. Stop Loss

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Stop loss order functionality** | "also include stop loss order functionality" | ✅ Met | stopLossService.js |

---

## 9. Splice Holding Interface

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Use Splice Holding interface** | "we need to use the splice token Holding interface and not custom templates" | ✅ Met | We use Splice token standard for CC/CBTC |

---

## 10. UI

| Requirement | Source | Status | Notes |
|-------------|--------|--------|-------|
| **Available balance (not just total)** | "The UI is showing total balance instead of available balance" | ✅ Met | Balance V2 API: available vs reserved |
| **Settlement signing UI** | "Please also give me the UI changes" | ✅ Met | PendingSettlements.jsx — Sign Withdraw, Sign Multi-Leg |

---

## Known Gaps / Deviations

### 1. Transaction 2: "App provider solely"

- **Client doc:** "Transaction 2 — Settlement (app provider only)" (no user signing at match)
- **Reality:** With ext-* parties, Withdraw and Create require user authorization. Participant cannot submit as ext-*.
- **Our approach:** TradingApp pattern — both parties sign at match (withdraw + multi-leg). This is the only way to achieve "no operator custody" with ext-*.
- **Status:** Documented in CLIENT_FLOW_GAP_ANALYSIS.md. Client/Huzaifa have not provided a DAML pattern for "app provider solely" with ext-*.

### 2. Self-transfer at order placement

- **Client doc:** Transaction 1 includes self-transfer (exact-amount holding) + self-allocation
- **Our implementation:** Self-allocation only. Self-transfer skipped (Canton: cannot combine in one interactive submission).
- **Impact:** Minor — allocation still locks tokens. Exact-amount holding would be cleaner.

### 3. When USE_TRADING_APP_PATTERN=false

- **Behavior:** Operator-as-receiver — tokens flow through operator. LockedAmulet artifacts may remain.
- **Client requirement:** Not acceptable. Operator-as-receiver violates "no app provider jurisdiction."
- **Action:** Ensure `USE_TRADING_APP_PATTERN=true` in production. No fallback to operator-as-receiver when createPendingSettlement fails (we removed that fallback).

---

## Checklist Summary

| # | Requirement | Compliant |
|---|-------------|-----------|
| 1 | No app provider jurisdiction | ✅ (TradingApp) |
| 2 | No operator raw private key | ✅ |
| 3 | No net locked after settlement | ✅ (TradingApp) |
| 4 | Allocations (not TransferInstruction) | ✅ |
| 5 | Token locking at order placement | ✅ |
| 6 | External parties | ✅ |
| 7 | Match making (partial/full, cancel, real transfer) | ✅ |
| 8 | Stop loss | ✅ |
| 9 | Splice Holding interface | ✅ |
| 10 | Available balance + Settlement UI | ✅ |

---

## Configuration Required

```env
USE_TRADING_APP_PATTERN=true
```

Without this, operator-as-receiver is used, which does **not** meet client requirements.
