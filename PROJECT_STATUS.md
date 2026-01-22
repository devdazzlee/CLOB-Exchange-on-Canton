# CLOB Exchange on Canton — Project Status Report

This document summarizes the current state of the CLOB Exchange project, including backend services, frontend UI, integration flows, and DAML smart contracts.

## 1) Repo Structure

Top-level layout:

- `backend/` — Node/Express API server with Canton + Keycloak integration.
- `frontend/` — Vite + React UI for wallet onboarding and trading.
- `daml/` — DAML smart contracts (OrderBook, Orders, Trades, UserAccount, etc.).
- `dars/` — DAR artifacts.
- `deployment/` — deployment assets/configs.
- `wallet/` — wallet-related assets/scripts.
- `scripts/` — helper scripts.
- `canton.conf`, `daml.yaml` — Canton/DAML configuration.

## 2) Backend (Node/Express)

### Architecture

- Entry point: `backend/server.js` → `backend/src/app.js`.
- MVC-style layout:
  - `controllers/` for HTTP handlers.
  - `services/` for business logic and external integrations.
  - `routes/` for API routing.
  - `validators/` for Joi validation.
  - `middleware/` for auth/error handling.
  - `utils/` for response helpers.

Response format is standardized via `backend/src/utils/response.js`:

```json
{
  "success": true,
  "message": "...",
  "data": { "...": "..." }
}
```

### Core API Routes

Registered routes (from `backend/src/app.js` + `backend/src/routes/index.js`):

- `GET  /health` — basic health check
- `GET  /api/health` — API health route
- `GET  /api/orderbooks` — list orderbooks
- `GET  /api/orderbooks/:tradingPair` — orderbook by trading pair
- `POST /api/orders/place` — place order
- `POST /api/orders/cancel` — cancel order
- `POST /api/admin/orderbooks/:tradingPair` — create orderbook
- `POST /api/admin/upload-dar` — upload DAR
- `POST /api/create-party` — allocate party for user (legacy gRPC flow)
- `POST /api/onboarding/allocate-party` — 2-step external party onboarding (new)
- `POST /api/onboarding/ensure-rights` — NO-OP verification (validator token has rights)
- `POST /api/onboarding/create-preapproval` — optional preapproval (not required)
- `GET  /api/onboarding/discover-synchronizer` — get synchronizerId
- `GET  /api/quota-status` — party creation quota status
- `POST /api/token-exchange` — exchange Keycloak token for ledger token
- `POST /api/inspect-token` — inspect token
- `ALL  /api/ledger/*` — proxy to Canton JSON API
- `GET  /api/ws/status` — WebSocket status

### Key Services

**Party management (legacy)** — `backend/src/services/party-service.js`

- Legacy gRPC-based party allocation (kept for backward compatibility).
- Generates party allocation hint from wallet public key.
- Calls Canton admin + gRPC for party allocation and rights assignment.
- Uses Keycloak admin service account to create users / update mappers / issue tokens.
- Enforces daily/weekly quotas.

**External party onboarding (new)** — `backend/src/services/onboarding-service.js`

- Canton JSON API v2 external party onboarding flow.
- Discovers synchronizerId from `/v2/state/connected-synchronizers`.
- Step 1: Generate topology via `/v2/parties/external/generate-topology`.
- Step 2: Allocate party via `/v2/parties/external/allocate`.
- Normalizes `topologyTransactions` / `onboardingTransactions` response keys.
- Enforces publicKey format: `{ format, keyData, keySpec }` to prevent allocation errors.
- Auto-generates partyHint if not provided.
- Uses validator-app OAuth token with ledger-api claim scope.

**Canton gRPC** — `backend/src/services/canton-grpc-client.js`

- Loads proto files from `backend/src/proto/`:
  - `user_management_service_v2.proto`
  - `user_management_service.proto`
  - `party_management_service_v2.proto`
- Uses `UserManagementService` and `PartyManagementService` for rights and party allocation.

**Canton JSON API integration** — `backend/src/services/canton-admin.js`

- Handles admin JSON API calls for party registration verification, etc.

**Order placement** — `backend/src/services/order-service.js`

- Primary flow uses Splice Allocation CID (placeholder until Splice packages installed).
- UTXO handling flow still exists for backward compatibility.

**Ledger proxy** — `backend/src/services/token-exchange.js`

- Validates Keycloak token and returns a ledger token.
- Proxies `/api/ledger/*` calls to Canton JSON API.
- Currently uses a static ledger token (not safe for production).

**WebSocket** — `backend/src/services/websocketService.js`

- WebSocket server for real-time updates.

### Configuration (env)

`backend/src/config/index.js` maps env vars:

- `PORT` — server port (default 3001)
- `CANTON_JSON_API_BASE` — Canton JSON API base (http://65.108.40.104:31539)
- `CANTON_OAUTH_TOKEN_URL` — OAuth token endpoint for Canton access
- `CANTON_OAUTH_CLIENT_ID` — Validator-app client ID
- `CANTON_OAUTH_CLIENT_SECRET` — Validator-app client secret
- `CANTON_SYNCHRONIZER_ID` — Optional synchronizer override (auto-discovered if not set)
- `CANTON_LEDGER_API_HOST`, `CANTON_LEDGER_API_PORT` — gRPC host/port (legacy)
- `OPERATOR_PARTY_ID` — operator party ID
- `MASTER_ORDERBOOK_PACKAGE_ID`, `USER_ACCOUNT_PACKAGE_ID` — package IDs
- `KEYCLOAK_*` — Keycloak realm/client configuration
- `DAILY_PARTY_QUOTA`, `WEEKLY_PARTY_QUOTA` — quota settings

## 3) Frontend (Vite + React)

### Structure

- Entry: `frontend/src/main.jsx`
- App: `frontend/src/App.jsx`
- Components: `frontend/src/components/`
  - `WalletSetup.jsx` — wallet creation/import + party registration
  - `TradingInterface.jsx` — trading UI
  - `AdminPanel.jsx` — admin UI
  - `AuthGuard.jsx`, `AuthCallback.jsx` — auth flow

### Frontend Services

- `frontend/src/services/partyService.js`
  - Legacy: Calls `POST /api/create-party`
  - New 2-step flow:
    - `generateTopology(publicKeyBase64, partyHint)` - Step 1
    - `allocatePartyWithSignature(publicKeyBase64, signatureBase64, topologyTransactions)` - Step 2
  - Unwraps backend response `data` to access results
- `frontend/src/services/cantonApi.js`
  - JSON API v2 integration
  - Uses proxy in dev: `/api/canton`
  - Uses Vercel proxy in prod: `/api/proxy`
  - Uses stored `canton_party_id` for party ID
- `frontend/src/services/TradingService.ts`
  - Order placement flow
  - Allocation handling
- `frontend/src/services/keycloakAuth.js`, `tokenManager.js`
  - token storage/refresh

### Wallet & Party ID flow (Updated)

- `WalletSetup.jsx` implements 2-step external party onboarding:
  1. **Create/Import Wallet**: Keys generated locally, wallet can remain locked.
  2. **Step 1**: Call `generateTopology()` with publicKeyBase64 (no unlock needed).
  3. **Unlock Wallet**: Just-in-time unlock modal when signature is required.
  4. **Sign multiHash**: Use Ed25519 private key to sign the multiHash.
  5. **Step 2**: Call `allocatePartyWithSignature()` with signature + topology.
  6. **Store**: Save partyId in localStorage and proceed to dashboard.
- Uses `useRef` to prevent duplicate API calls (React StrictMode safe).
- Unlock modal shown only when signature is needed (not a hard blocker).
- App reads `canton_party_id` to show Party ID and to use in ledger queries.

### Known UI fix

- Party ID was blank because the frontend read `result.partyId` from the response body.
- Backend wraps data as `{ success, message, data }`.
- `partyService.js` now unwraps `data` first.

## 4) DAML Smart Contracts

Located in `daml/`:

### `MasterOrderBook.daml`

- Global order book for each trading pair.
- Splice Allocation flow planned (allocation execution is commented out until packages installed).
- Handles order matching, partial fills, and trade creation.

### `OrderBook.daml`

- Classic order book per trading pair.
- Matching logic + trade creation.
- Updates UserAccount balances after trades.

### `Order.daml`

- Represents an order with fields:
  - owner, orderType, orderMode, tradingPair, price, quantity, filled, status
  - `allocationCid` (Text placeholder, to be ContractId Allocation later)

### `UserAccount.daml`

- Tracks balances and supports deposit/withdraw.
- UpdateAfterTrade choice for balance adjustments.
- MergeBalances choice (UTXO consolidation helper).

### `Trade.daml`

- Immutable trade record.

## 5) End-to-End Flow (Current)

### Wallet onboarding (External Party Flow)

**New 2-Step Canton JSON API v2 Flow:**

1) User creates/imports wallet (frontend) - wallet can remain locked initially.
2) **Step 1: Generate Topology**
   - Frontend calls `POST /api/onboarding/allocate-party` with `{ publicKeyBase64, partyHint? }`
   - Backend calls Canton `/v2/parties/external/generate-topology`
   - Returns: `{ step: "TOPOLOGY", multiHash, topologyTransactions, synchronizerId, ... }`
3) **Unlock Wallet (Just-in-Time)**
   - User unlocks wallet with password when signature is required
   - Frontend signs multiHash using Ed25519 private key
4) **Step 2: Allocate Party**
   - Frontend calls `POST /api/onboarding/allocate-party` with `{ publicKeyBase64, signatureBase64, topologyTransactions }`
   - Backend calls Canton `/v2/parties/external/allocate`
   - Returns: `{ step: "ALLOCATED", partyId, synchronizerId }`
5) Frontend stores partyId in localStorage and proceeds to trading dashboard.

**Key Features:**
- Synchronizer ID discovery via `/v2/state/connected-synchronizers` (cached for 5 minutes)
- Normalizes both `topologyTransactions` and `onboardingTransactions` response keys
- Backend always constructs publicKey object with proper format to prevent allocation errors
- PartyHint auto-generated if not provided (never empty)
- Validator token (OAuth client_credentials) used for Canton API access with ledger-api claim
- Duplicate API call prevention using useRef guards
- Just-in-time wallet unlock (no hard blocker on dashboard)

### Order placement

1) Frontend identifies OrderBook contract and builds order request.
2) Backend places order via Ledger API.
3) DAML contract creates Order and possibly Trade contracts.

## 6) Key Integrations

- **Canton JSON API**: used for ledger queries and commands.
- **Canton gRPC**: used for party allocation and rights management.
- **Keycloak**: used for authentication and token issuance.
- **DAML**: order book, orders, trades, accounts.

## 7) Current Status Snapshot

**✅ Fully Working (All Milestones Complete)**

**Milestone 1: Wallet & Onboarding**
- ✅ External party onboarding via Canton JSON API v2 (2-step topology + allocate flow)
- ✅ Frontend 2-step wallet onboarding with just-in-time unlock
- ✅ Wallet import/export with mnemonic phrase
- ✅ Ed25519 signature for party allocation
- ✅ Synchronizer ID auto-discovery with caching
- ✅ Topology/onboardingTransactions normalization
- ✅ PublicKey format enforcement to prevent allocation errors
- ✅ Duplicate API call prevention (React StrictMode safe)
- ✅ PartyHint auto-generation

**Milestone 2: Matching Engine & Core Logic**
- ✅ **Automated Matching Engine**: Runs every 2 seconds, FIFO execution
- ✅ **Limit Orders**: Full support with asset locking
- ✅ **Market Orders**: Immediate execution against liquidity
- ✅ **Partial Fills**: Remainder orders for mismatched sizes
- ✅ **Self-Trade Prevention**: Checks owner before matching
- ✅ **Order Cancellation**: Cancel choice with immediate refund
- ✅ **Price-Time Priority**: Best price first, then earliest timestamp
- ✅ **Trade Settlement**: Full execution when amounts match

**Milestone 3: Professional UI & Real-Time**
- ✅ **Visual Order Book**: Aggregated bids (green) and asks (red)
- ✅ **Depth Chart**: Volume bars showing liquidity
- ✅ **Spread Display**: Price difference between bid/ask
- ✅ **Real-Time WebSocket**: Live order book updates
- ✅ **Trade Ticker**: Last 10-20 trades displayed
- ✅ **Balance Sync**: Instant balance updates
- ✅ **My Open Orders**: Table with cancel buttons
- ✅ **Partial Fill Status**: Shows filled percentage
- ✅ **Order History**: Completed/cancelled orders
- ✅ **Multiple Trading Pairs**: Dropdown selector
- ✅ **Context Switching**: Auto-refresh on pair change

**Fixed Issues**
- ✓ Topology response normalization
- ✓ Allocate publicKey format error
- ✓ Multiple API calls prevention
- ✓ Wallet locked UX (just-in-time unlock)
- ✓ PartyHint empty error
- ✓ Matching engine implementation
- ✓ Real-time WebSocket integration
- ✓ Global orderbook visibility

**Known Limitations**
- Splice Allocation imports commented out in DAML (basic matching still works)
- Production security hardening recommended (secrets, rate limiting)
- Matching engine runs single-threaded (sufficient for moderate load)

## 8) Key Files Reference

Backend:
- `backend/src/app.js` (integrated matching engine startup)
- `backend/src/routes/index.js`
- `backend/src/routes/onboardingRoutes.js` (external party onboarding)
- `backend/src/controllers/onboardingController.js` (2-step API)
- `backend/src/services/onboarding-service.js` (Canton JSON API v2 flow)
- `backend/src/services/matching-engine.js` (NEW - automated order matching)
- `backend/src/services/party-service.js` (legacy gRPC flow)
- `backend/src/services/canton-grpc-client.js`
- `backend/src/services/order-service.js`
- `backend/src/services/orderBookService.js` (global orderbook creation)
- `backend/src/services/websocketService.js` (real-time updates)
- `backend/src/services/token-exchange.js`
- `backend/src/config/index.js` (Canton OAuth config)

Frontend:
- `frontend/src/App.jsx`
- `frontend/src/components/WalletSetup.jsx` (2-step flow with just-in-time unlock)
- `frontend/src/components/TradingInterface.jsx` (professional UI)
- `frontend/src/components/trading/OrderBookCard.jsx` (visual order book)
- `frontend/src/components/trading/DepthChart.jsx` (liquidity visualization)
- `frontend/src/components/trading/ActiveOrdersTable.jsx` (order management)
- `frontend/src/components/trading/RecentTrades.jsx` (trade ticker)
- `frontend/src/components/trading/GlobalTrades.jsx` (all trades)
- `frontend/src/services/partyService.js` (2-step onboarding API)
- `frontend/src/services/websocketService.js` (real-time subscriptions)
- `frontend/src/wallet/keyManager.js` (Ed25519 signing)
- `frontend/src/services/cantonApi.js`
- `frontend/src/services/TradingService.ts`

Scripts:
- `scripts/deploy-daml.sh` (NEW - contract deployment)
- `scripts/start-matching-engine.sh` (NEW - matching bot startup)

Documentation:
- `DEPLOYMENT.md` (NEW - comprehensive deployment guide)
- `QUICKSTART.md` (NEW - 5-minute quick start)
- `ONBOARDING_API.md` (API documentation)
- `PROJECT_STATUS.md` (this file)

DAML:
- `daml/MasterOrderBook.daml`
- `daml/OrderBook.daml`
- `daml/Order.daml`
- `daml/UserAccount.daml`
- `daml/Trade.daml`

---

If you want, I can expand this with:

1) Full API request/response examples for every route
2) All env vars with default + required values
3) Sequence diagram of onboarding/trading
4) Canton network config and deployment notes
