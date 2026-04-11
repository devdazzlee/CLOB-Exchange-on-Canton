# CLOB Exchange — Frontend

React 18 single-page app for the Canton-powered CLOB exchange. Built with [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/), and [React Router](https://reactrouter.com/). Trading UI talks to the Node backend over HTTP and uses WebSockets for live order books, trades, and balances.

## Prerequisites

- Node.js 18+ (project tooling aligns with the repo’s backend; Node 22 is fine)
- A running backend API (default `http://localhost:3001`) — see the repository `backend/` README

## Setup

```bash
cd frontend
cp .env.example .env
# Edit .env: set VITE_API_BASE_URL to your backend (e.g. http://localhost:3001/api)
yarn install
```

All client-side configuration uses the `VITE_*` prefix so Vite exposes them to the browser. Never commit real secrets; keep them in `.env` (gitignored).

## Scripts

| Command        | Description                          |
|----------------|--------------------------------------|
| `yarn dev`     | Start Vite dev server (port **3000**) |
| `yarn build`   | Production build to `dist/`          |
| `yarn preview` | Serve the production build locally   |

## Environment variables

Copy from `.env.example` and adjust for your deployment:

- `VITE_API_BASE_URL` — Base URL for the exchange backend API (e.g. `http://localhost:3001/api`)
- `VITE_TOKEN_STANDARD_PACKAGE_ID` / `VITE_CLOB_EXCHANGE_PACKAGE_ID` — DAML package IDs used in the UI
- `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM`, `VITE_KEYCLOAK_CLIENT_ID` — Keycloak settings for Canton devnet auth flows

## Development notes

- The Vite dev server proxies some Canton JSON API paths under `/api/canton` (see `vite.config.js`) for local development with the WolfEdge participant host.
- Ensure the backend is up before testing orders, balances, or onboarding flows that call `/api/*`.

## Production build

```bash
yarn build
```

Serve the `dist/` folder with any static host or behind your API gateway, and set `VITE_API_BASE_URL` to the public backend URL at build time.
