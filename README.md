# CLOB Exchange on Canton

A high-performance Central Limit Order Book (CLOB) exchange built on the Canton protocol using DAML and the Token Standard (Amulet/Splice).

## Architecture overview
The exchange follows a hybrid architecture, combining the speed of off-chain matching with the security and atomic settlement of Canton (DAML).

1. **Frontend (React/Vite)**: Modern trading dashboard built with Tailwind CSS, Recharts, and generic UI components. Uses JWT tokens obtained from Keycloak (through wallet extension/plugin) for secure authentication.
2. **Backend (Node.js/Express)**: A low-latency state-keeping server.
   - Maintains an in-memory limit order book.
   - Listens to the Canton JSON API (via WebSocket streaming read model) to track new unfulfilled orders and trades.
   - Instantly acts as a matching engine.
3. **Canton/DAML (Smart Contracts)**:
     - Implements the Splice API (`splice-api-token-allocation-v1`, `splice-api-token-holding-v1` etc.).
     - Uses **2-transaction lifecycle**: 
       1. User places an Order (creates an interactive `Allocation` on their funds).
       2. Exchange (operator) locks the order (`Order` contract). 
     - **Atomic Settlement**: Matches cross-orders by executing the allocations directly inside the `ExchangeSettlerHub` (DAML contract), allowing 0-counterparty hazard and no operator custody. The `executor` is securely assigned to the actual node operators (e.g. `cardiv`).

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- Yarn package manager
- PostgreSQL (for backend state indexing)
- A running Canton network & Ledger API (gRPC + JSON-API via HTTP)
- A configured Oauth 2.0 Auth Server (e.g., Keycloak)

### 1. Backend Setup
1. Open the `backend` folder.
2. Copy `.env.example` to `.env` and fill in the required Canton node credentials, package IDs, and PostgreSQL connection.
3. Run `yarn install` to download dependencies.
4. (Optional) Ensure the PostgreSQL database is reachable.
5. Setup schemas: The backend uses simple internal tables/state; refer to DB config docs within `src/state` if migrations are needed.
6. Run `yarn dev` to start the backend with auto-reload, or `yarn start` for production.

### 2. Frontend Setup
1. Open the `frontend` folder.
2. Copy `.env.example` to `.env` and ensure `VITE_API_BASE_URL` points to your running backend (e.g., `http://localhost:3001/api`).
3. Run `yarn install`.
4. Run `yarn dev` to start the Vite development server.

### 3. DAML Smart Contracts
The DAML package (`clob-exchange`) can be built inside the `daml` folder.
- Compile: `daml build`
- Output: `daml/clob-wolfedge-tokens-2.6.0.dar`
- Deploy this DAR to your Canton Devnet network using the Canton Admin API.

## Backend Routes

- `POST /api/onboarding/onboard`
  Automatically requests tokens, mints dummy holdings (if needed), allocates identities and creates the party context.
- `GET /api/balance/v2/:partyId`
  Aggregates total, available, and reserved balances (based on pending allocated token holdings) from Canton.
- `POST /api/order/place-v2`
  Initiates a DvP limit order. Returns a `preparedTransactionHash` from the Canton ledger that requires user interactive signature.
- `POST /api/order/execute`
  Accepts the user-signed order hash and finalizes the step 1 allocation and triggers step 2 order contract creation in ONE backend routine.
- `POST /api/order/cancel`
  Cancels the live order and releases locked allocations.
- `GET /api/trades/:ticker` & `GET /api/orderbooks/:ticker`
  Serves the live read-only state for frontend displays.
