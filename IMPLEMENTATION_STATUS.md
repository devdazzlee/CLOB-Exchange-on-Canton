# Implementation Status

## ✅ Completed

### Monorepo Structure
- ✅ Created monorepo with workspaces
- ✅ `/packages/crypto` - Ed25519 keypair, encryption, backup utilities
- ✅ `/packages/api-clients` - Canton JSON API and Scan API clients (structure)
- ✅ `/apps/api` - Backend API server structure
- ✅ `/apps/web` - Frontend React app structure
- ✅ `/daml/exchange` - DAML contracts (Market, UserRole, LimitOrder, Trade)

### Milestone 1 Foundation
- ✅ Crypto package with Ed25519 keypair generation
- ✅ Encryption/decryption with PBKDF2 + AES-GCM
- ✅ Seed phrase backup/restore (BIP39)
- ✅ Wallet service (frontend)
- ✅ Onboarding service structure (frontend & backend)
- ✅ OAuth token service
- ✅ DAML contracts: Market, UserRole, LimitOrder, Trade
- ✅ Backend API routes for onboarding

## 🚧 In Progress / Needs Completion

### Milestone 1 - Critical Missing Pieces

1. **External Party Allocation Implementation**
   - ⚠️ Need to discover actual template ID and choice names from installed packages
   - ⚠️ Implement proper signing flow (multiHash signing with private key)
   - ⚠️ Complete `allocateExternalParty` in CantonJsonApiClient
   - ⚠️ Add package introspection to discover templates

2. **Transfer Preapproval Creation**
   - ⚠️ Discover template/choice for CreateTransferPreapproval
   - ⚠️ Implement actual creation logic
   - ⚠️ Verify creation via Scan API

3. **Faucet Logic**
   - ⚠️ Implement "Get Test Funds" button
   - ⚠️ Discover TransferFactory/AllocationFactory from instrument registry
   - ⚠️ Exercise factory choice with correct disclosedContracts + choiceContextData
   - ⚠️ Integrate with Token Standard

4. **Frontend Wallet UI**
   - ⚠️ Create wallet setup component
   - ⚠️ Create unlock/login component
   - ⚠️ Create backup confirmation flow
   - ⚠️ Create onboarding flow UI
   - ⚠️ Create dashboard with party ID and balances

5. **Package/Template Discovery**
   - ⚠️ Implement package introspection endpoint
   - ⚠️ Query installed packages from JSON API
   - ⚠️ Extract template IDs and choice names
   - ⚠️ Cache discovered templates

### Milestone 2 - Not Started

1. **Order Booking Logic**
   - ⚠️ Verify balance using token-standard holdings
   - ⚠️ Lock assets (cash for BUY, token for SELL)
   - ⚠️ Implement escrow model
   - ⚠️ Create LimitOrder contract on-ledger

2. **Matching Engine**
   - ⚠️ Create `/apps/matcher` service
   - ⚠️ Subscribe to ledger events via gRPC
   - ⚠️ Maintain in-memory order book
   - ⚠️ Implement price-time priority matching
   - ⚠️ Self-trade prevention

3. **Settlement & Partial Fills**
   - ⚠️ Implement DvP settlement
   - ⚠️ Use Token Standard Allocation workflow
   - ⚠️ Handle partial fills
   - ⚠️ Update remainingQty and locked holdings

4. **Cancellation Logic**
   - ⚠️ Archive LimitOrder
   - ⚠️ Unlock/refund escrowed holdings
   - ⚠️ Test balance increase after cancel

5. **Indexer Service**
   - ⚠️ Create `/apps/indexer` service
   - ⚠️ Stream ledger transactions
   - ⚠️ Materialize: orders, trades, balances, orderbook_levels
   - ⚠️ REST endpoints: /markets, /orderbook, /trades, /me/orders, /me/history

### Milestone 3 - Not Started

1. **Visual Order Book**
   - ⚠️ Bids (green) and asks (red) grouped by price
   - ⚠️ Depth bars proportional to size
   - ⚠️ Spread display

2. **Real-Time WebSocket Feeds**
   - ⚠️ Backend WebSocket channels: orderbook:{market}, trades:{market}, balances:{party}
   - ⚠️ Push updates from indexer/matcher

3. **Order Management UI**
   - ⚠️ My Open Orders table
   - ⚠️ Cancel button
   - ⚠️ Partial fill progress
   - ⚠️ Order History tab

4. **Multiple Pairs & Navigation**
   - ⚠️ Market selector dropdown
   - ⚠️ Switch market updates all panels

5. **Charting**
   - ⚠️ Integrate lightweight-charts
   - ⚠️ OHLC candles from trade history
   - ⚠️ Aggregated candles endpoint

## 🔧 Technical Debt / Improvements Needed

1. **OpenAPI Client Generation**
   - Need to fetch actual OpenAPI specs from:
     - JSON API: http://65.108.40.104:31539 (endpoint TBD)
     - Scan API: http://65.108.40.104:8088/api/scan (endpoint TBD)
   - Generate typed clients using openapi-generator

2. **Error Handling**
   - Add comprehensive error handling throughout
   - User-friendly error messages
   - Retry logic for network calls

3. **Testing**
   - Unit tests for crypto operations
   - Integration tests for onboarding flow
   - E2E tests for order placement/matching

4. **Database Schema**
   - Design schema for indexer
   - Create migration scripts

5. **Security**
   - Validate all user inputs
   - Rate limiting
   - CSRF protection

## 📝 Next Steps (Priority Order)

1. **Immediate (Milestone 1 Completion)**
   - Implement package introspection to discover template IDs
   - Complete external party allocation with actual signing
   - Implement transfer preapproval creation
   - Build frontend wallet UI components
   - Implement faucet logic

2. **Short-term (Milestone 2)**
   - Build matching engine
   - Build indexer
   - Implement order booking with asset locking
   - Implement settlement logic

3. **Medium-term (Milestone 3)**
   - Build Pro UI
   - Implement WebSocket real-time feeds
   - Add charting

## 🔍 Discovery Tasks

These require querying the live network to discover:

1. **External Party Template**
   - Query packages to find ExternalParty template
   - Find generateExternalParty choice
   - Find allocateExternalParty choice

2. **Transfer Preapproval Template**
   - Find CreateTransferPreapproval choice
   - Discover required parameters

3. **Token Standard Templates**
   - Find TransferFactory template
   - Find AllocationFactory template
   - Discover instrument registry structure

4. **Faucet Templates**
   - Discover faucet/preapproval patterns
   - Find required choices for test fund allocation
