# Setup Instructions - Fix "Templates do not exist" Error

## Problem

When running `npm run init-orderbooks`, you get:
```
"Templates do not exist: [dd43244140e4d07f8ae813d1037b87476e253dea70569bce1a80169353bfbbe0:OrderBook:OrderBook]"
```

This means the DAML contracts haven't been uploaded to Canton yet.

## Solution: Upload DAML Contracts First

### Step 1: Build DAML Contracts

```bash
cd daml
daml build
```

This creates the DAR file at `.daml/dist/clob-exchange-1.0.0.dar`

### Step 2: Upload DAR to Canton

**Option A: Using the upload script (Recommended)**

```bash
# From project root
export JWT_TOKEN="your-admin-token-here"  # Get from backend/.env or Keycloak
./scripts/upload-dar.sh
```

**Option B: Using JSON API**

```bash
# Get admin token first (from backend)
cd backend
node -e "require('dotenv').config(); const admin = require('./canton-admin'); admin.getAdminToken().then(t => console.log(t))"

# Then upload DAR
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/packages \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- << EOF
{
  "dar": "$(base64 -i .daml/dist/clob-exchange-1.0.0.dar | tr -d '\n')"
}
EOF
```

### Step 3: Verify Contracts Are Uploaded

```bash
# Check if OrderBook template exists
curl -X POST http://95.216.34.215:31539/v2/packages \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

You should see the package ID in the response.

### Step 4: Create OrderBooks

Now you can run:

```bash
cd backend
npm run init-orderbooks
```

---

## Quick Fix Script

Create a file `setup-and-init.sh`:

```bash
#!/bin/bash
set -e

echo "🔨 Step 1: Building DAML contracts..."
cd daml
daml build
cd ..

echo "📦 Step 2: Uploading DAR to Canton..."
# You'll need to set JWT_TOKEN first
if [ -z "$JWT_TOKEN" ]; then
  echo "⚠️  JWT_TOKEN not set. Getting from backend..."
  cd backend
  export JWT_TOKEN=$(node -e "require('dotenv').config(); const admin = require('./canton-admin'); admin.getAdminToken().then(t => console.log(t))")
  cd ..
fi

./scripts/upload-dar.sh

echo "✅ Step 3: Creating OrderBooks..."
cd backend
npm run init-orderbooks

echo "🎉 Setup complete!"
```

---

## Alternative: Use Backend Admin Endpoint Directly

If you have the backend running, you can also use the admin panel or call the endpoint directly after uploading the DAR:

```bash
# After DAR is uploaded, create OrderBooks via API
curl -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT \
  -H "Content-Type: application/json"
```

---

## Troubleshooting

### "DAR file not found"
- Run `cd daml && daml build` first
- Check that `.daml/dist/clob-exchange-1.0.0.dar` exists

### "grpcurl not found"
- Install: `brew install grpcurl` (macOS) or `apt-get install grpcurl` (Linux)

### "Authentication failed"
- Make sure `JWT_TOKEN` is set correctly
- Get token from Keycloak or backend admin service

### "Templates still not found after upload"
- Wait a few seconds for Canton to process the upload
- Check package ID matches in backend logs
- Verify you're using the correct participant node

