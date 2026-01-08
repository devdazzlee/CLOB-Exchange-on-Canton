# Diagram Generation Prompts for CLOB Exchange on Canton

## Prompt 1: System Architecture Diagram

```
Create a detailed system architecture diagram for a CLOB (Central Limit Order Book) Exchange built on Canton blockchain using DAML smart contracts. 

The diagram should show:

**Frontend Layer:**
- React Web Application (deployed on Vercel)
- User Interface Components:
  - Wallet Setup & Management (key generation, seed phrase backup)
  - Trading Interface (order placement, order book display)
  - Balance Display
  - Active Orders Table
- WebSocket Client for real-time updates

**Authentication Layer:**
- Keycloak OAuth Server
- JWT Token Management
- User Session Management

**Backend/Blockchain Layer:**
- Canton Network (distributed ledger)
- DAML Smart Contracts:
  - UserAccount contract (stores user balances: BTC, USDT)
  - Order contract (buy/sell orders with price, quantity, status)
  - OrderBook contract (maintains buy/sell order lists per trading pair)
  - Trade contract (executed trades)
- Canton JSON API (REST endpoints for contract queries and commands)
- Canton Admin API (gRPC for party management)
- Canton Ledger API (gRPC for user rights management)

**Data Flow:**
- Frontend → Keycloak (authentication)
- Frontend → Canton JSON API (contract queries, order placement)
- Frontend → WebSocket (real-time order book updates)
- Backend → Canton Admin API (party creation, user rights)
- Canton → Frontend (contract state updates via WebSocket)

**Key Features to Highlight:**
- Privacy: Users only see their own orders and trades (Canton's privacy model)
- Real-time: WebSocket connections for live order book updates
- Security: DAML contracts ensure deterministic execution
- Multi-pair: Support for multiple trading pairs (BTC/USDT, ETH/USDT, etc.)

Use a modern, clean diagram style with clear labels, arrows showing data flow direction, and color coding for different layers (Frontend in blue, Authentication in green, Blockchain in orange).
```

## Prompt 2: User Flow & Feature Diagram

```
Create a comprehensive user flow and feature diagram for a CLOB Exchange on Canton blockchain. Show the complete user journey from onboarding to trading.

**Phase 1: User Onboarding & Wallet Setup**
1. User visits application
2. Wallet Creation Flow:
   - Generate cryptographic key pair (public/private key)
   - Create wallet address
   - Display seed phrase for backup
   - Store encrypted private key in browser localStorage
   - User confirms backup completion
3. Authentication:
   - Redirect to Keycloak OAuth
   - User logs in with credentials
   - Receive JWT token
   - Store token securely
4. Party Registration:
   - Backend creates Canton party for user (via Admin API)
   - Grant user rights (can_act_as, can_read_as)
   - Generate party-specific token
   - Store party ID in localStorage

**Phase 2: Account Setup**
1. Check if UserAccount contract exists
2. If not exists: Display message "UserAccount needs to be created by operator"
3. If exists: Display balances (BTC, USDT)

**Phase 3: Trading Interface**
1. User selects trading pair (BTC/USDT, ETH/USDT, etc.)
2. Order Book Display:
   - Show buy orders (sorted by price descending)
   - Show sell orders (sorted by price ascending)
   - Real-time updates via WebSocket
3. Order Placement:
   - User selects order type (Limit or Market)
   - User selects side (Buy or Sell)
   - Enter price (for limit orders) and quantity
   - Submit order
4. Order Processing:
   - Check if OrderBook contract exists for trading pair
   - If not, create OrderBook contract
   - Create Order contract
   - Add order to OrderBook (buyOrders or sellOrders array)
   - Match orders if price conditions met
   - Execute trade if matched
   - Update balances
   - Update order book display

**Phase 4: Order Management**
1. View Active Orders:
   - Display user's open orders
   - Show order details (price, quantity, filled, status)
2. Cancel Order:
   - User selects order to cancel
   - Exercise CancelOrder choice on Order contract
   - Remove order from OrderBook
   - Update order book display

**Phase 5: Real-time Updates**
- WebSocket connection maintains live order book
- Polling every 5 seconds for balance and order updates
- Display latest trades and order book changes

**Key Decision Points:**
- OrderBook exists? → Yes: Place order | No: Create OrderBook first
- Order matches? → Yes: Execute trade | No: Add to order book
- UserAccount exists? → Yes: Show balance | No: Show creation message

Use flowchart symbols (rectangles for processes, diamonds for decisions, arrows for flow) with clear labels. Color code different phases (Onboarding in purple, Trading in blue, Management in green).
```

## Prompt 3: Contract Interaction & Data Flow Diagram

```
Create a detailed DAML contract interaction and data flow diagram for the CLOB Exchange smart contracts on Canton.

**Contracts Structure:**

1. **UserAccount Contract:**
   - Template: UserAccount
   - Fields: owner (Party), balances (Map Text Decimal)
   - Signatories: owner
   - Choices:
     - UpdateBalance (add/subtract from balances)
     - Transfer (transfer between accounts)

2. **Order Contract:**
   - Template: Order
   - Fields: orderId, owner, orderType (BUY/SELL), orderMode (LIMIT/MARKET), tradingPair, price, quantity, filled, status (OPEN/FILLED/CANCELLED), timestamp, operator
   - Signatories: owner, operator
   - Choices:
     - AddOrder (create new order)
     - CancelOrder (cancel open order)
     - FillOrder (execute partial/full fill)

3. **OrderBook Contract:**
   - Template: OrderBook
   - Fields: tradingPair, buyOrders (List ContractId), sellOrders (List ContractId), lastPrice, operator
   - Signatories: operator
   - Choices:
     - AddOrder (add order to buyOrders or sellOrders)
     - RemoveOrder (remove order from list)
     - UpdateLastPrice (update last executed price)

4. **Trade Contract:**
   - Template: Trade
   - Fields: tradeId, buyer, seller, tradingPair, price, quantity, timestamp
   - Signatories: buyer, seller

**Interaction Flow:**

1. **Order Placement:**
   - User → Frontend: Submit order form
   - Frontend → Canton JSON API: Exercise AddOrder choice on OrderBook
   - OrderBook → Creates: New Order contract
   - OrderBook → Updates: Adds Order contractId to buyOrders/sellOrders
   - OrderBook → Archives: Old OrderBook contract
   - OrderBook → Creates: New OrderBook contract with updated order list

2. **Order Matching:**
   - System checks: Buy order price >= Sell order price
   - If match found:
     - Exercise FillOrder on both Order contracts
     - Create Trade contract
     - Update UserAccount balances (deduct from buyer, add to seller)
     - Update OrderBook (remove filled orders, update lastPrice)
     - Archive old contracts, create new ones

3. **Order Cancellation:**
   - User → Frontend: Click cancel
   - Frontend → Canton JSON API: Exercise CancelOrder choice on Order contract
   - Order → Updates: status = CANCELLED
   - OrderBook → Exercise RemoveOrder: Remove contractId from buyOrders/sellOrders
   - OrderBook → Archives old, creates new

4. **Balance Query:**
   - Frontend → Canton JSON API: Query UserAccount contracts
   - Filter by: owner = user's party
   - Display: balances map (BTC, USDT)

5. **Order Book Query:**
   - Frontend → Canton JSON API: Query OrderBook contracts
   - Filter by: tradingPair
   - Extract: buyOrders and sellOrders contract IDs
   - Frontend → Canton JSON API: Fetch each Order contract by ID
   - Display: Sorted orders with price, quantity

**Privacy Model:**
- Users can only see contracts where they are signatories or observers
- OrderBook is visible to all parties (public order book)
- UserAccount is only visible to owner
- Order is visible to owner and operator

Use UML-style diagram with:
- Boxes for contracts (with template name and key fields)
- Arrows showing contract creation and updates
- Labels on arrows showing choice names
- Color coding: UserAccount (green), Order (blue), OrderBook (orange), Trade (purple)
- Show contract lifecycle (Create → Active → Archive → Create new)
```

## Prompt 4: Technical Stack & Integration Diagram

```
Create a technical stack and integration diagram showing all technologies, APIs, and connections for the CLOB Exchange.

**Technology Stack:**

**Frontend:**
- React 18+ (UI framework)
- Vite (build tool)
- Tailwind CSS (styling)
- Shadcn/ui (component library)
- Framer Motion (animations)
- WebSocket API (real-time updates)
- Axios/Fetch (HTTP client)

**Authentication:**
- Keycloak (OAuth 2.0 / OpenID Connect)
- JWT tokens (access tokens)
- Browser localStorage (token storage)

**Blockchain Infrastructure:**
- Canton Network (distributed ledger)
- DAML (smart contract language)
- Canton JSON API (REST endpoints)
- Canton Admin API (gRPC - party management)
- Canton Ledger API (gRPC - user rights)

**Backend Services:**
- Node.js Express server (proxy/party creation)
- Party Service (creates parties via gRPC)
- Keycloak Admin API (user management)
- Canton gRPC Client (party allocation, rights management)

**Deployment:**
- Vercel (frontend hosting)
- Canton DevNet (blockchain network)
- Wolf Edge Labs infrastructure

**API Endpoints:**

Frontend → Backend:
- POST /api/create-party (create user party)
- GET /api/canton/v2/packages (get package ID)
- POST /api/canton/v2/state/active-contracts (query contracts)
- POST /api/canton/v2/commands/submit-and-wait (create/exercise contracts)

Backend → Canton:
- gRPC: PartyManagementService.AllocateParty
- gRPC: UserManagementService.GrantUserRights
- REST: /v2/state/active-contracts
- REST: /v2/commands/submit-and-wait

**Data Flow:**
1. User → Keycloak: OAuth login
2. Keycloak → Frontend: JWT token
3. Frontend → Backend: Create party request
4. Backend → Canton Admin API: Allocate party
5. Backend → Canton Ledger API: Grant user rights
6. Backend → Frontend: Party ID + token
7. Frontend → Canton JSON API: Query/create contracts
8. Canton → Frontend: WebSocket updates

**Security Layers:**
- HTTPS (all connections)
- JWT token validation
- CORS configuration
- Private key encryption (browser storage)
- DAML authorization (contract signatories)

Show as a layered architecture with:
- Top layer: User/Browser
- Second layer: Frontend Application
- Third layer: Authentication & Backend Services
- Bottom layer: Canton Blockchain Network

Use different colors for each layer and show bidirectional arrows for API calls. Include icons/logos for major technologies where possible.
```

---

## How to Use These Prompts

1. **Copy the prompt** you want to use (Architecture, User Flow, Contract Interaction, or Technical Stack)
2. **Paste into Gemini** (Google's AI image generator or text-to-diagram tool)
3. **Request format**: "Generate a diagram based on this description: [paste prompt]"
4. **Iterate**: If the first result isn't perfect, refine the prompt with more specific details
5. **Combine**: You can generate multiple diagrams and combine them in a presentation

## Recommended Diagram Types

- **Architecture Diagram**: Use Prompt 1 (shows overall system)
- **User Journey**: Use Prompt 2 (shows user flows)
- **Technical Details**: Use Prompt 3 (shows contract interactions)
- **Integration View**: Use Prompt 4 (shows all technologies)

You can also combine elements from multiple prompts to create a comprehensive diagram that covers all aspects of the system.

