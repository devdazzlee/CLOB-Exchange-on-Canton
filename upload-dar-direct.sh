#!/bin/bash
set -e

# Access token
ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1Njc5NDgsImlhdCI6MTc2ODU2NjE0OCwiYXV0aF90aW1lIjoxNzY4NTY2MTM5LCJqdGkiOiJvbnJ0YWM6NzExNTlkOTQtYWExNS0xNDA4LTY3YzEtYmQzMWY3ZDg0YWU2IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiNDIzOGZiZjMtOTZkOS00Y2FiLWE5NWQtNzM2MDBiNzA5YjliIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.zf2ztblorz8rtTYBXmdtSeCRNBsbIBaClnMv9xQjMvqevYFDab5A-gFvW_G1JcQDfCepgTBFvOvcOL2XCJA_9o5wLIoy1qbUcYzsZqWmMLWprkEw37Wjtg20vssWC1Se2A6jJYkrHJ3hnqL4FjlhytMAPQvaxAt2ohh7ki8yZUN6z36I7Nf07gJVYmQi9QPjBzIn0e6bjMrjVObVHX83ta3yQNuVRdCaaGdaRFXZpXxcAjedwSO4Tg8ecmVvZlJ9lXUaryZK7RXOJnUzp8Zp9HKDdBGem9GxAO1Vv6xmI75Lhmx7c6BnZMFHv8Q8abiOFQuxr3rvu7Ke5dOH_WBBwQ"

# Find DAR file
DAR_FILE=""
if [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
elif [ -f "daml/.daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_FILE="daml/.daml/dist/clob-exchange-1.0.0.dar"
else
    echo "❌ DAR file not found"
    exit 1
fi

echo "📤 Uploading DAR file: $DAR_FILE"
echo "Size: $(ls -lh "$DAR_FILE" | awk '{print $5}')"
echo ""

# Try JSON API first (simpler)
echo "Method 1: Trying JSON API endpoint..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "https://participant.dev.canton.wolfedgelabs.com/json-api/v1/packages" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${DAR_FILE}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "✅ DAR uploaded successfully via JSON API (HTTP $HTTP_CODE)"
    echo ""
    echo "Response:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    exit 0
elif echo "$BODY" | grep -q "KNOWN_PACKAGE_VERSION"; then
    echo "⚠️  DAR already uploaded (KNOWN_PACKAGE_VERSION) - this is OK"
    echo "The package is already deployed and active."
    exit 0
else
    echo "⚠️  JSON API upload failed (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
    echo ""
    echo "Trying gRPC method..."
fi

# Try gRPC with TLS
echo "Method 2: Trying gRPC with TLS..."
BASE64_DAR=$(base64 -i "$DAR_FILE" | tr -d '\n')

GRPC_REQUEST=$(jq -n \
    --arg bytes "$BASE64_DAR" \
    '{
        "dars": [{
            "bytes": $bytes
        }],
        "vet_all_packages": true,
        "synchronize_vetting": true
    }')

# Use -insecure for self-signed certs, or remove for proper TLS
GRPC_RESPONSE=$(echo "$GRPC_REQUEST" | grpcurl \
    -insecure \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d @ \
    participant.dev.canton.wolfedgelabs.com:443 \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1)

if [ $? -eq 0 ]; then
    echo "✅ DAR uploaded successfully via gRPC"
    echo ""
    echo "Response:"
    echo "$GRPC_RESPONSE" | jq '.' 2>/dev/null || echo "$GRPC_RESPONSE"
    exit 0
elif echo "$GRPC_RESPONSE" | grep -q "KNOWN_PACKAGE_VERSION"; then
    echo "⚠️  DAR already uploaded (KNOWN_PACKAGE_VERSION) - this is OK"
    exit 0
else
    echo "❌ gRPC upload also failed"
    echo "Error: $GRPC_RESPONSE"
    exit 1
fi

