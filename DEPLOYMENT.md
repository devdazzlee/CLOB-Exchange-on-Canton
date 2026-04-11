# CLOB Exchange Deployment Guide

This guide covers setting up the CLOB Exchange on a fresh Canton network/participant.

## 1. Canton Node Setup
You must have a running Canton Devnet or fresh Canton Network. 
The node must have:
- A `participant` configured.
- The `JSON Ledger API` running and exposing HTTP + WebSocket ports.
- The `Ledger API (gRPC)` and `Admin API (gRPC)` enabled.
- A synchronizer domain connected (e.g., `global-domain`).

## 2. Setting up Identities
1. **Operator Identity**: Use Canton console to allocate a party for the `operator`. This party will be responsible for creating users and Order contracts.
2. **Executor Identity**: Allocate a `cardiv` party (or any named executor) intended to settle memory orders. 
3. Note their party IDs for `.env`.

## 3. Uploading Smart Contracts
The exchange depends on specific DAML models.
1. Download the required Splice `.dar` dependencies (Amulet/Splice token standards).
2. Build the CLOB package: `cd daml && daml build`.
3. Upload all `.dar` files to your participant. You can use Canton console (`participant.dars.upload("path/to/file")`) or the gRPC endpoint.
4. Retrieve the newly generated package ID for `clob-exchange` and the token standard.
   
## 4. Oauth Setup
If using Keycloak (like Devnet):
1. Setup a Realm (e.g., `canton-devnet`).
2. Create an OAuth client for the **Operator** (enabling client credentials flow).
3. Create an OAuth client for the **Executor/Cardiv**.
4. Configure the Canton network to validate tokens from Keycloak using JWKS.
5. Create a `canton-devnet` client for the Web UI (Public Client, PKCE).

## 5. PostgreSQL Setup
The backend requires a PostgreSQL database to store order state and settlements.
1. Run a PostgreSQL database.
2. Provide the `DATABASE_URL` in the `backend/.env`.
3. Push schema: `cd backend && npx prisma db push`.

## 6. Backend Configuration
Create a `.env` in the `backend/` directory referencing `backend/.env.example`.
Start the backend using:
```bash
cd backend
yarn install
yarn start
```
*Ensure pm2 or docker handles auto-restarts in production.*

## 7. Frontend Configuration
Create a `.env` in the `frontend/` directory referencing `frontend/.env.example`.
Build the frontend:
```bash
cd frontend
yarn install
yarn build
```
Deploy the resulting `/dist` folder using NGINX, Vercel, or any static file host. Ensure React Router rewrites work (redirect `/*` to `/index.html`).

## 8. Sanity Check / Smoke Test
1. Log into the Frontend using a user account.
2. Connect wallet (automatically creates identity through Keycloak/Oauth + backend).
3. The Operator should be granting identity automatically. 
4. Check balances (`TradeSettlement` and Splice balance should load).
5. Open an Order. The user interface will prompt for a Web3/Keycloak signing action.
6. Check backend logs for exactly:
   - `TX1=Allocation (user)`
   - `TX2=Order:Order created for ...`
   - Order should appear in order book.
