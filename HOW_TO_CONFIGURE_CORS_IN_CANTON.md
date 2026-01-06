# How to Configure CORS in Canton

## Yes, CORS CAN be Configured in Canton Configuration Files!

You're absolutely right - CORS **can** be configured in Canton's configuration files. However, there's an important distinction:

### ✅ What CAN be Configured
- **Canton Node Configuration** (`canton.conf`) - This is where CORS is configured
- This is **server-side infrastructure configuration**, not DAML contract code

### ❌ What CANNOT be Configured
- **DAML Contracts** - Smart contracts cannot handle HTTP/CORS
- DAML contracts define business logic, not server configuration

## Where to Configure CORS

### Option 1: If You Control the Canton Node

If you have access to the Canton server, add CORS configuration to `canton.conf`:

```hocon
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

Then restart the Canton node for changes to take effect.

### Option 2: If You Use a Remote Canton Node (Your Case)

Since you're using `participant.dev.canton.wolfedgelabs.com` (a remote node), you **don't have access** to modify the configuration file.

**You need to:**
1. Contact **Wolf Edge Labs** (the Canton node operator)
2. Request they add your domain to CORS allowed origins
3. Provide them with the configuration (see `canton.conf` file in this project)

## Configuration File Location

I've created a `canton.conf` file in your project root that shows the exact CORS configuration needed. However:

⚠️ **This file is just a template/reference** - it needs to be on the Canton SERVER, not in your project.

## Steps to Get CORS Configured

### Step 1: Contact Canton Node Operator

Send this to Wolf Edge Labs:

```
Subject: CORS Configuration Request

Hi,

I'm deploying a frontend application that needs to access the Canton JSON API.

Frontend URL: https://clob-exchange-on-canton.vercel.app
Canton API: https://participant.dev.canton.wolfedgelabs.com/json-api

Could you please add the following CORS configuration to the Canton participant node:

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

Thank you!
```

### Step 2: After CORS is Configured

Once CORS is properly configured on the Canton server:

1. **Remove the proxy** from `frontend/vite.config.js`
2. **Remove the Vercel serverless function** (`frontend/api/canton/[...path].js`)
3. **Update `frontend/src/services/cantonApi.js`**:

```javascript
// Change from:
const CANTON_API_BASE = '/api/canton';  // Proxy

// To:
const CANTON_API_BASE = 'https://participant.dev.canton.wolfedgelabs.com/json-api';  // Direct
```

## Summary

- ✅ **Yes**, CORS can be configured in Canton configuration files (`canton.conf`)
- ✅ **Yes**, this is the proper solution (not a proxy workaround)
- ⚠️ **But**, you need access to the Canton server to modify it
- 📧 **Action**: Contact Wolf Edge Labs to add your domain to CORS allowed origins

The `canton.conf` file I created shows exactly what configuration is needed. Once the Canton node operator adds it, you can remove all the proxy code!


