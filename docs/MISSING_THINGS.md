# Missing or Partial Items — Detailed Gap Analysis

This document lists checklist items that are **Partial** or **Missing** in the current codebase, with evidence, impact, and what is required to complete them.

---

## Milestone 1: Foundation, Wallet & Identity

### 1) DAML Core Contracts (Assets)

#### A) Asset Templates: Cash (USD/Stablecoin) and Token (BTC/Stock) — **Missing**

**Evidence**
- No DAML templates named Cash/Token/Asset found in `daml/`.
- Current asset representation is only via `UserAccount` balances map.

**Impact**
- No on-ledger asset contracts exist to represent holdings as contracts.
- Cannot model asset ownership or transfer as contract-level events.

**What’s required**
- DAML templates for at least:
  - `Cash` (USD/USDT stablecoin)
  - `Token` (BTC/Stock)
- Minting and transfer choices for both templates.

**Related files**
- `daml/UserAccount.daml` (balances map only)
- `daml/OrderBook.daml`, `daml/MasterOrderBook.daml` (trading logic references token symbols but no asset contracts)

---

#### B) User Role Contract (Party holds assets) — **Partial**

**Evidence**
- `UserAccount` exists and tracks balances as a `Map Text Decimal`.
- No explicit “role” or “wallet” contract that binds a Party to owned assets as contracts.

**Impact**
- User ownership is implicit in a balance map rather than explicit contracts.
- Harder to enforce on-ledger ownership rules and audit asset history.

**What’s required**
- A contract that clearly associates a Party with on-ledger assets (e.g., `Wallet` or `Portfolio` template), or migrate to asset contracts entirely.

**Related files**
- `daml/UserAccount.daml`

---

#### C) Faucet/Minting Logic (Get Test Funds) — **Partial**

**Evidence**
- Frontend calls `POST /api/testnet/mint-tokens` and shows “Mint Test Tokens” guidance.
- No backend route found for `/api/testnet/mint-tokens`.

**Impact**
- Users can’t reliably mint tokens from the app if the endpoint is missing.
- Balance bootstrap relies on assumptions or manual ledger setup.

**What’s required**
- Backend route to mint test assets and create `UserAccount` balances.
- DAML or JSON API logic to create asset contracts or update balances.

**Related files**
- `frontend/src/components/TradingInterface.jsx`
- `frontend/src/services/cantonApi.js`

---

## Milestone 2: Matching Engine & Core Logic

### 1) Order Booking Logic (DAML)

#### A) Limit Order Contract with asset locking — **Partial**

**Evidence**
- `Order` template exists, but `allocationCid` is only a `Text` placeholder.
- Splice allocation execution logic is commented out in `MasterOrderBook.daml` and `Order.daml`.

**Impact**
- Funds are not locked on-ledger when an order is placed.
- Order placement doesn’t enforce economic constraints at contract level.

**What’s required**
- Install Splice packages or replace with on-ledger asset transfer/lock contracts.
- Change `allocationCid` to an actual `ContractId Allocation` and execute lock/transfer.

**Related files**
- `daml/Order.daml`
- `daml/MasterOrderBook.daml`

---

#### B) Market Order Logic (Immediate execution) — **Partial**

**Evidence**
- Matching logic supports market orders (price = None).
- Settlement logic still depends on commented allocation execution.

**Impact**
- Market orders may match in logic, but assets are not transferred on-ledger.

**What’s required**
- Proper asset transfer execution in settlement logic.

**Related files**
- `daml/OrderBook.daml`
- `daml/MasterOrderBook.daml`

---

#### C) Asset Locking (Available → Locked) — **Partial**

**Evidence**
- There is no explicit “locked” vs “available” balance model in DAML.
- Allocation lock/cancel calls are commented out.

**Impact**
- Orders don’t reduce available balances on-chain.
- Overspending possible if not enforced by off-chain checks.

**What’s required**
- On-ledger locking or escrow contract, or Splice allocation integration.

**Related files**
- `daml/Order.daml`
- `daml/MasterOrderBook.daml`

---

### 2) Settlement & Partial Fills

#### A) Full Execution (Asset swap when matched) — **Partial**

**Evidence**
- Trade records created but allocation execution is commented out.

**Impact**
- Ledger does not show actual asset transfers on trade execution.

**What’s required**
- Execute allocation transfers or asset swap contracts in matching flow.

**Related files**
- `daml/MasterOrderBook.daml`

---

### 3) Cancellation Logic

#### A) Cancel Choice + Refund — **Partial**

**Evidence**
- `CancelOrder` exists, but allocation cancel is commented out.

**Impact**
- Cancelling an order does not release locked funds on-ledger.

**What’s required**
- Implement allocation cancel or escrow release.

**Related files**
- `daml/Order.daml`
- `daml/MasterOrderBook.daml`

---

## Milestone 3: Professional UI & Real-Time Data

### 1) Real-Time Balance Sync — **Partial**

**Evidence**
- Balances refresh after trades/cancel via frontend triggers, but no explicit real-time balance push from server.

**Impact**
- UI may lag behind the ledger without manual refresh or polling.

**What’s required**
- Push balance changes over WebSocket or subscribe to ledger update stream.

**Related files**
- `frontend/src/components/TradingInterface.jsx`
- `frontend/src/services/websocketService.js`

---

### 2) Candlestick Chart (Basic OHLC) — **Missing**

**Evidence**
- No charting library usage (no lightweight-charts or OHLC rendering found).

**Impact**
- Users lack price chart visualization.

**What’s required**
- Integrate a charting library and build OHLC data from trades.

**Related files**
- None found in `frontend/src/`.

---

## Summary of Gaps (Quick List)

- Asset templates (Cash/Token) — Missing
- User role/asset-holding contract — Partial
- Faucet/minting backend endpoint — Partial
- Asset locking/escrow for orders — Partial
- Allocation execution (Splice) — Partial
- Cancellation refunds — Partial
- Real-time balance sync — Partial
- Candlestick chart — Missing

