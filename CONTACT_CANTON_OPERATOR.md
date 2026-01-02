# Contact Canton Node Operator - CORS Configuration Request

## 📧 Email Template

Send this email to **Wolf Edge Labs** (Canton node operator):

---

**Subject:** CORS Configuration Request for CLOB Exchange Frontend

**To:** [Contact Wolf Edge Labs - Canton Support]

**Body:**

Hi,

I'm deploying a frontend application that needs to make direct API requests to the Canton JSON API.

**Frontend URL:** `https://clob-exchange-on-canton.vercel.app`  
**Canton API:** `https://participant.dev.canton.wolfedgelabs.com/json-api`

Could you please add the following CORS configuration to the Canton participant node to allow requests from my frontend domain?

```hocon
canton {
  participants {
    participant {
      api {
        cors {
          allowed-origins = [
            "https://clob-exchange-on-canton.vercel.app",
            "http://localhost:3000",
            "http://localhost:5173"
          ]
          allowed-methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
          allowed-headers = ["Content-Type", "Authorization", "X-Requested-With"]
          allow-credentials = true
          max-age = 86400
        }
      }
    }
  }
}
```

**For development, please also allow:**
- `http://localhost:3000`
- `http://localhost:5173`

Once CORS is configured, I'll be able to make direct API calls from the browser without needing a proxy.

Thank you!

---

## 📋 What to Include

1. **Your frontend URL:** `https://clob-exchange-on-canton.vercel.app`
2. **Canton API endpoint:** `https://participant.dev.canton.wolfedgelabs.com/json-api`
3. **CORS configuration** (see `canton.conf` file)
4. **Development URLs** (localhost for testing)

## ✅ After CORS is Configured

Once Wolf Edge Labs confirms CORS is configured:

1. **Test from browser:**
   ```javascript
   // Open browser console on your frontend
   fetch('https://participant.dev.canton.wolfedgelabs.com/json-api/v2/packages', {
     headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
   })
   .then(r => r.json())
   .then(console.log)
   ```

2. **If no CORS errors:** ✅ CORS is working!
3. **If CORS errors:** Contact them again with error details

## 🔍 How to Find Contact Information

1. Check Canton documentation
2. Check `participant.dev.canton.wolfedgelabs.com` for contact info
3. Check Wolf Edge Labs website
4. Check Canton community forums

## 📝 Alternative: Check if CORS Already Works

Before contacting them, test if CORS might already be configured:

```bash
# Test from browser console on your frontend
fetch('https://participant.dev.canton.wolfedgelabs.com/json-api/v2/packages', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
})
.then(r => {
  console.log('Status:', r.status);
  return r.json();
})
.then(data => console.log('Success:', data))
.catch(err => console.error('CORS Error:', err));
```

**If you get CORS error:** Contact them with the configuration above.  
**If no CORS error:** CORS is already configured! ✅

