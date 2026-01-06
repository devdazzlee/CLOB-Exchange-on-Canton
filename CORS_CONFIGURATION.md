# CORS Configuration for CLOB Exchange

## Overview

CORS (Cross-Origin Resource Sharing) must be configured on the **Canton server** to allow your frontend domain to make API requests.

## Production Frontend Domain

Your live frontend is deployed at:
- **URL:** https://clob-exchange-on-canton.vercel.app/

## CORS Configuration Required

The Canton node at `participant.dev.canton.wolfedgelabs.com` needs to allow requests from your Vercel domain.

### Required CORS Headers

The Canton server should return these headers for requests from your frontend:

```
Access-Control-Allow-Origin: https://clob-exchange-on-canton.vercel.app
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
```

### Allowed Origins

Add the following origin to the Canton node's CORS configuration:

```
https://clob-exchange-on-canton.vercel.app
```

For development, you may also want to allow:
```
http://localhost:3000
http://localhost:5173
```

## How to Configure CORS on Canton Node

### Option 1: Contact Canton Support

Since you're using `participant.dev.canton.wolfedgelabs.com`, you'll need to:

1. **Contact Wolf Edge Labs** (the Canton node operator)
2. **Request CORS configuration** for your domain
3. **Provide them with:**
   - Your frontend URL: `https://clob-exchange-on-canton.vercel.app`
   - Required headers (listed above)

### Option 2: If You Have Admin Access

If you have admin access to the Canton node, you can configure CORS in the Canton configuration file:

```yaml
# canton.conf
canton {
  participants {
    participant {
      api {
        cors {
          allowed-origins = [
            "https://clob-exchange-on-canton.vercel.app",
            "http://localhost:3000"
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

## Testing CORS Configuration

### Test from Browser Console

Open your browser console on https://clob-exchange-on-canton.vercel.app/ and run:

```javascript
fetch('https://participant.dev.canton.wolfedgelabs.com/json-api/v2/parties', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

### Expected Behavior

✅ **Success:** Request completes without CORS errors
❌ **Failure:** You'll see an error like:
```
Access to fetch at 'https://participant.dev.canton.wolfedgelabs.com/json-api/v2/parties' 
from origin 'https://clob-exchange-on-canton.vercel.app' has been blocked by CORS policy
```

## Development vs Production

### Development (Local)
- Uses Vite proxy (`/api/canton` → `/json-api`)
- Proxy handles CORS automatically
- No CORS issues in development

### Production (Vercel)
- Makes direct requests to Canton API
- Requires CORS configuration on Canton server
- Must be configured by Canton node operator

## Current Status

⚠️ **Action Required:** Contact Wolf Edge Labs to add your Vercel domain to the Canton node's CORS allowed origins list.

## Contact Information

For CORS configuration:
- **Canton Node:** participant.dev.canton.wolfedgelabs.com
- **Operator:** Wolf Edge Labs
- **Your Frontend:** https://clob-exchange-on-canton.vercel.app

## Alternative Solutions

If CORS cannot be configured on the Canton server, you could:

1. **Use a Backend Proxy** (Recommended)
   - Deploy a simple Node.js/Express server
   - Proxy requests from frontend → backend → Canton
   - Backend handles CORS

2. **Use Vercel Serverless Functions**
   - Create API routes in Vercel
   - Proxy requests through serverless functions
   - Functions handle CORS

3. **Browser Extension** (Not recommended for production)
   - Use CORS browser extension for testing only
   - Not suitable for end users

## Next Steps

1. ✅ Document CORS requirements (this file)
2. ⏳ Contact Canton node operator to add your domain
3. ⏳ Test CORS configuration once added
4. ⏳ Verify frontend works in production


