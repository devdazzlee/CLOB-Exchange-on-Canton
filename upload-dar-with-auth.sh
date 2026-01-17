#!/bin/bash
set -e

# =============================================================================
# Upload DAR to Canton using Client Credentials
# =============================================================================

# Keycloak Configuration (Operator credentials)
KEYCLOAK_URL="https://keycloak.wolfedgelabs.com:8443"
REALM="canton-devnet"
CLIENT_ID="snp3u6udkFF983rfprvsBbx3X3mBpw"
CLIENT_SECRET="l5Td3OUSanQoGeNMWg2nnPxq1VYc"

# Canton Configuration
CANTON_API="http://65.108.40.104:31539"

# Find DAR file
DAR_FILE=""
if [ -f ".daml/dist/clob-exchange-utxo-1.0.0.dar" ]; then
    DAR_FILE=".daml/dist/clob-exchange-utxo-1.0.0.dar"
elif [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
else
    echo "❌ DAR file not found in .daml/dist/"
    echo "Run 'daml build' first"
    exit 1
fi

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          CLOB Exchange - DAR Upload Script                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📦 DAR file: $DAR_FILE"
echo "📏 Size: $(ls -lh "$DAR_FILE" | awk '{print $5}')"
echo ""

# Step 1: Get access token using client credentials
echo "🔑 Step 1: Getting access token from Keycloak..."
TOKEN_RESPONSE=$(curl -s -X POST \
    "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}" \
    -d "scope=openid daml_ledger_api")

# Extract access token
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Failed to get access token"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

echo "✅ Got access token (${#ACCESS_TOKEN} chars)"
echo ""

# Step 2: Upload DAR to Canton
echo "📤 Step 2: Uploading DAR to Canton..."

# Try the v2 packages endpoint
UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${CANTON_API}/v2/packages" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${DAR_FILE}" \
    --max-time 120)

HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "✅ DAR uploaded successfully!"
    echo "Response: $RESPONSE_BODY"
elif [ "$HTTP_CODE" = "409" ]; then
    echo "ℹ️  DAR already uploaded (409 Conflict)"
    echo "This is fine - the package already exists on the ledger"
else
    echo "⚠️  Upload returned status: $HTTP_CODE"
    echo "Response: $RESPONSE_BODY"
    
    # Try alternative endpoint
    echo ""
    echo "🔄 Trying alternative endpoint..."
    UPLOAD_RESPONSE2=$(curl -s -w "\n%{http_code}" -X POST \
        "${CANTON_API}/v1/packages" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/octet-stream" \
        --data-binary "@${DAR_FILE}" \
        --max-time 120)
    
    HTTP_CODE2=$(echo "$UPLOAD_RESPONSE2" | tail -n1)
    RESPONSE_BODY2=$(echo "$UPLOAD_RESPONSE2" | sed '$d')
    
    echo "HTTP Status: $HTTP_CODE2"
    
    if [ "$HTTP_CODE2" = "200" ] || [ "$HTTP_CODE2" = "201" ]; then
        echo "✅ DAR uploaded successfully via v1 endpoint!"
    elif [ "$HTTP_CODE2" = "409" ]; then
        echo "ℹ️  DAR already uploaded (409 Conflict)"
    else
        echo "❌ Upload failed"
        echo "Response: $RESPONSE_BODY2"
    fi
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Next step: Run the deployment script to create MasterOrderBooks"
echo "  cd backend && node scripts/deploymentScript.js"
echo "════════════════════════════════════════════════════════════════"
