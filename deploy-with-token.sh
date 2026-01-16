#!/bin/bash
set -e

# Access token from user
ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1Njc5NDgsImlhdCI6MTc2ODU2NjE0OCwiYXV0aF90aW1lIjoxNzY4NTY2MTM5LCJqdGkiOiJvbnJ0YWM6NzExNTlkOTQtYWExNS0xNDA4LTY3YzEtYmQzMWY3ZDg0YWU2IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiNDIzOGZiZjMtOTZkOS00Y2FiLWE5NWQtNzM2MDBiNzA5YjliIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.zf2ztblorz8rtTYBXmdtSeCRNBsbIBaClnMv9xQjMvqevYFDab5A-gFvW_G1JcQDfCepgTBFvOvcOL2XCJA_9o5wLIoy1qbUcYzsZqWmMLWprkEw37Wjtg20vssWC1Se2A6jJYkrHJ3hnqL4FjlhytMAPQvaxAt2ohh7ki8yZUN6z36I7Nf07gJVYmQi9QPjBzIn0e6bjMrjVObVHX83ta3yQNuVRdCaaGdaRFXZpXxcAjedwSO4Tg8ecmVvZlJ9lXUaryZK7RXOJnUzp8Zp9HKDdBGem9GxAO1Vv6xmI75Lhmx7c6BnZMFHv8Q8abiOFQuxr3rvu7Ke5dOH_WBBwQ"

echo "🔨 Step 1: Setting up DAML SDK path..."
export PATH="$HOME/.daml/bin:$PATH"

echo "📦 Step 2: Building DAML contracts..."

# Find daml.yaml
if [ -f "daml/daml.yaml" ]; then
    cd daml
    DAML_DIR="."
elif [ -f "daml.yaml" ]; then
    DAML_DIR="."
else
    echo "❌ Error: daml.yaml not found"
    exit 1
fi

export PATH="$HOME/.daml/bin:$PATH"
daml build
if [ $? -ne 0 ]; then
    echo "❌ Error: DAML build failed"
    exit 1
fi

# Find DAR file
DAR_FILE=""
if [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
elif [ -f "../.daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE="../.daml/dist/clob-exchange-1.0.0.dar"
elif [ -f "daml/.daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE="daml/.daml/dist/clob-exchange-1.0.0.dar"
else
    echo "❌ Error: DAR file not found"
    echo "Searched: .daml/dist/clob-exchange-1.0.0.dar"
    echo "Searched: daml/.daml/dist/clob-exchange-1.0.0.dar"
    exit 1
fi

# Get absolute path
DAR_FILE=$(cd "$(dirname "$DAR_FILE")" && pwd)/$(basename "$DAR_FILE")

# Return to root if we changed directory
if [ "$DAML_DIR" = "." ] && [ -f "daml.yaml" ]; then
    # We're in daml directory, go back
    cd ..
fi

echo "✅ DAR file built: $DAR_FILE"
echo ""

# Step 3: Check for required tools
echo "🔍 Step 3: Checking for required tools..."

if ! command -v grpcurl &> /dev/null; then
    echo "❌ Error: grpcurl is not installed"
    echo "Install with: brew install grpcurl (macOS) or apt-get install grpcurl (Linux)"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is not installed"
    echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

echo "✅ Required tools found"
echo ""

# Step 4: Base64 encode DAR file
echo "📤 Step 4: Preparing DAR file for upload..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS (BSD base64)
    BASE64_DAR=$(base64 -i "$DAR_FILE" | tr -d '\n')
else
    # Linux (GNU base64)
    BASE64_DAR=$(base64 -w 0 "$DAR_FILE")
fi

echo "✅ DAR file encoded (size: ${#BASE64_DAR} characters)"
echo ""

# Step 5: Prepare gRPC request
echo "📝 Step 5: Preparing gRPC request..."

GRPC_REQUEST=$(jq -n \
    --arg bytes "$BASE64_DAR" \
    '{
        "dars": [{
            "bytes": $bytes
        }],
        "vet_all_packages": true,
        "synchronize_vetting": true
    }')

PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443

echo "Uploading to: ${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}"
echo ""

# Step 6: Upload DAR using gRPC
echo "🚀 Step 6: Uploading DAR to Canton..."
echo ""

RESPONSE=$(echo "$GRPC_REQUEST" | timeout 60 grpcurl \
    -plaintext \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d @ \
    "${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}" \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1)

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ DAR uploaded successfully!"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    echo ""
    
    # Step 7: Wait for processing
    echo "⏳ Step 7: Waiting for Canton to process DAR (10 seconds)..."
    sleep 10
    
    # Step 8: Verify deployment
    echo "🔍 Step 8: Verifying deployment..."
    echo ""
    
    VERIFY_RESPONSE=$(curl -s -X GET \
        "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/packages" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/json")
    
    if echo "$VERIFY_RESPONSE" | grep -q "OrderBook" || echo "$VERIFY_RESPONSE" | grep -q "51522c77"; then
        echo "✅ OrderBook template found in packages!"
        echo ""
        echo "Package verification:"
        echo "$VERIFY_RESPONSE" | jq '.' 2>/dev/null | head -30 || echo "$VERIFY_RESPONSE" | head -30
    else
        echo "⚠️  OrderBook template not immediately visible (may need more time)"
        echo "Response:"
        echo "$VERIFY_RESPONSE" | head -20
    fi
    
    echo ""
    echo "🎉 Deployment complete!"
    echo ""
    echo "Next steps:"
    echo "1. Initialize OrderBooks:"
    echo "   cd backend && npm run init-orderbooks"
    echo ""
    echo "2. Start backend:"
    echo "   cd backend && npm start"
    echo ""
    echo "3. Start frontend:"
    echo "   cd frontend && npm run dev"
    echo ""
    echo "4. Visit http://localhost:5173 to start trading"
    echo ""
else
    # Check if it's a known package version error (which is OK)
    if echo "$RESPONSE" | grep -q "KNOWN_PACKAGE_VERSION"; then
        echo "⚠️  DAR already uploaded (KNOWN_PACKAGE_VERSION) - this is OK"
        echo "The package is already deployed and active."
        echo ""
        echo "Response:"
        echo "$RESPONSE" | head -10
        echo ""
        echo "✅ Deployment verified (package already exists)"
    else
        echo "❌ Upload failed"
        echo "Error:"
        echo "$RESPONSE"
        exit 1
    fi
fi

