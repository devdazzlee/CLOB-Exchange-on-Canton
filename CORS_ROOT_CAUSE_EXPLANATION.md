# CORS Root Cause - Why Proxy is Needed

## The Real Problem

**CORS is NOT a DAML contract issue. It's a browser security feature.**

### What is CORS?

CORS (Cross-Origin Resource Sharing) is a **browser security mechanism** that prevents websites from making requests to different domains unless the server explicitly allows it.

### Why We Need a Proxy

1. **Browser makes request:** `https://clob-exchange-on-canton.vercel.app` → `https://participant.dev.canton.wolfedgelabs.com`
2. **Browser checks CORS:** "Does the Canton server allow requests from vercel.app?"
3. **Canton server response:** Missing or incorrect CORS headers
4. **Browser blocks request:** ❌ CORS error

### The Proper Solution (Not Proxy)

The **correct solution** is to configure CORS on the Canton API server:

```yaml
# Canton server configuration (NOT in DAML contract)
canton {
  participants {
    participant {
      api {
        cors {
          allowed-origins = [
            "https://clob-exchange-on-canton.vercel.app"
          ]
          allowed-methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
          allowed-headers = ["Content-Type", "Authorization"]
          allow-credentials = true
        }
      }
    }
  }
}
```

## Why We Can't Fix This in DAML

**DAML contracts are smart contracts on the ledger. They don't handle HTTP requests or CORS.**

- DAML contracts define business logic (orders, trades, accounts)
- HTTP/CORS is handled by the Canton API server (infrastructure layer)
- You cannot configure CORS in a DAML contract

## Current Workaround (Proxy)

Since we don't control the Canton server configuration, we use a proxy:

```
Browser → Vercel Proxy → Canton API
         (same origin)   (CORS handled)
```

This works because:
- Browser sees request as same-origin (to Vercel)
- Vercel proxy makes server-to-server request (no CORS)
- Proxy forwards response back to browser

## The Real Fix

**Contact Wolf Edge Labs** (Canton node operator) and request:

1. Add `https://clob-exchange-on-canton.vercel.app` to CORS allowed origins
2. Configure CORS headers on the Canton API server
3. Once configured, you can remove the proxy and make direct requests

## What to Tell Canton Support

```
Subject: CORS Configuration Request for CLOB Exchange

Hi,

I'm deploying a frontend application at:
https://clob-exchange-on-canton.vercel.app

The application needs to make API requests to:
https://participant.dev.canton.wolfedgelabs.com/json-api

Could you please add my domain to the CORS allowed origins with these settings:
- Origin: https://clob-exchange-on-canton.vercel.app
- Methods: GET, POST, PUT, DELETE, OPTIONS
- Headers: Content-Type, Authorization
- Credentials: true

Thank you!
```

## After CORS is Configured

Once CORS is properly configured on the Canton server, you can:

1. **Remove the proxy** from `vite.config.js`
2. **Remove the Vercel serverless function** (`api/canton/[...path].js`)
3. **Update `cantonApi.js`** to call Canton API directly:

```javascript
// After CORS is fixed, change this:
const CANTON_API_BASE = '/api/canton';  // Proxy

// To this:
const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';  // Direct
```

## Summary

- ❌ **Wrong:** Configure CORS in DAML contract (impossible)
- ✅ **Right:** Configure CORS on Canton API server (infrastructure)
- 🔧 **Workaround:** Use proxy until CORS is configured (current solution)

The proxy is a **temporary workaround** until the Canton server is properly configured. Once CORS is fixed on the server, the proxy can be removed.


