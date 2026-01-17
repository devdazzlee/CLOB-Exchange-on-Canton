#!/bin/bash
set -e

# =============================================================================
# CLOB Exchange - DAR Upload Script (Fixed with Working Credentials)
# =============================================================================

# Keycloak Configuration (Operator credentials from image_abcdeb.png)
CLIENT_ID="snp3u6udkFF983rfprvsBbx3X3mBpw"
CLIENT_SECRET="l5Td3OUSanQoGeNMWg2nnPxq1VYc"
KEYCLOAK_URL="https://keycloak.wolfedgelabs.com:8443"
REALM="canton-devnet"

# Canton API Configuration
CANTON_UPLOAD_URL="https://participant.dev.canton.wolfedgelabs.com/v1/packages"

# Find DAR file
DAR_FILE=""
if [ -f ".daml/dist/clob-exchange-utxo-1.0.0.dar" ]; then
    DAR_FILE=".daml/dist/clob-exchange-utxo-1.0.0.dar"
elif [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
elif [ -f "daml/.daml/dist/clob-exchange-utxo-1.0.0.dar" ]; then
    DAR_FILE="daml/.daml/dist/clob-exchange-utxo-1.0.0.dar"
elif [ -f "daml/.daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE="daml/.daml/dist/clob-exchange-1.0.0.dar"
else
    echo "❌ DAR file not found"
    echo "Expected: .daml/dist/clob-exchange-utxo-1.0.0.dar"
    echo "Run 'daml build' first to create the DAR file"
    exit 1
fi

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          CLOB Exchange - DAR Upload (Fixed)                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📦 DAR file: $DAR_FILE"
echo "📏 Size: $(ls -lh "$DAR_FILE" | awk '{print $5}')"
echo ""

# Step 1: Get access token from Keycloak
echo "🔑 Step 1: Getting access token from Keycloak..."
TOKEN_URL="${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token"

TOKEN_RESPONSE=$(curl -s -X POST "$TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}" \
    -d "scope=openid daml_ledger_api")

# Extract access token using jq if available, otherwise use grep/sed
if command -v jq &> /dev/null; then
    ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
    ERROR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')
    ERROR_DESC=$(echo "$TOKEN_RESPONSE" | jq -r '.error_description // empty')
else
    # Fallback: use grep/sed
    ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
    ERROR=$(echo "$TOKEN_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
    ERROR_DESC=$(echo "$TOKEN_RESPONSE" | grep -o '"error_description":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    echo "❌ Failed to get access token"
    echo "Response: $TOKEN_RESPONSE"
    if [ -n "$ERROR" ]; then
        echo "Error: $ERROR"
        if [ -n "$ERROR_DESC" ]; then
            echo "Description: $ERROR_DESC"
        fi
    fi
    exit 1
fi

echo "✅ Got access token (${#ACCESS_TOKEN} chars)"
echo ""

# Step 2: Upload DAR to Canton
echo "📤 Step 2: Uploading DAR to Canton..."
echo "   URL: $CANTON_UPLOAD_URL"
echo ""

UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CANTON_UPLOAD_URL" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${DAR_FILE}" \
    --max-time 120)

HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "✅ DAR uploaded successfully!"
    echo ""
    echo "Response:"
    if command -v jq &> /dev/null; then
        echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
    else
        echo "$RESPONSE_BODY"
    fi
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "✅ SUCCESS! MasterOrderBook template is now on the ledger"
    echo ""
    echo "Next steps:"
    echo "1. Restart your backend: cd backend && npm restart"
    echo "2. Run deployment script: node scripts/deploymentScript.js"
    echo "════════════════════════════════════════════════════════════════"
    exit 0
elif [ "$HTTP_CODE" = "409" ]; then
    echo "ℹ️  DAR already uploaded (409 Conflict)"
    echo "This is fine - the package already exists on the ledger"
    echo ""
    echo "Response: $RESPONSE_BODY"
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "ℹ️  Package already deployed - you can proceed with deployment"
    echo "════════════════════════════════════════════════════════════════"
    exit 0
elif echo "$RESPONSE_BODY" | grep -qi "KNOWN_PACKAGE_VERSION"; then
    echo "ℹ️  DAR already uploaded (KNOWN_PACKAGE_VERSION)"
    echo "The package is already deployed and active."
    exit 0
else
    echo "❌ Upload failed"
    echo "Response: $RESPONSE_BODY"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check that the token is valid"
    echo "2. Verify the DAR file exists: $DAR_FILE"
    echo "3. Check network connectivity to Canton"
    exit 1
fi
