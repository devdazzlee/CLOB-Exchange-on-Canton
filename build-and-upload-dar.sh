#!/bin/bash
set -e

# Access token from user
ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1NTg2MjAsImlhdCI6MTc2ODU1NjgyMCwiYXV0aF90aW1lIjoxNzY4NTU2ODE1LCJqdGkiOiJvbnJ0YWM6N2YxMzlhOGUtZGJjYy00ZTcxLTYwM2ItNWZlOTQyN2U5YzQ4IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiMGU4MWQ3MzgtNjAzNy00OTY5LTgwOTctZWM0M2FlMWI2MjA2IiwiYWNyIjoiMSIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.cJj0B3vp3fYjSCG4or6IRYtnZugnGpKUgUxLOVmdGOrSYLeZ7d--mGNFEGqHMeXtXmjDrG6mY2uR9-DwXyoXnqs1LEAmno9tlQtC2yh_EAaF2wM93hpY27BVFWqD2Ytb8avsAA_fa84u3ij2EduEe6Lxwx_fqqV2bXVJvfKVKSstldwFtrLyLNEgiKNhjzMhYcPgkHuAtA9dG1CtP5nJkRydR1nIANWo138CtIaeUntGrQ4VJUbruC4EyJi3djBwFDahv1NOLrwhHflrCs5Gz1LWNkfDiCOcLge4twMcL5u6zy5yC9zgQ7TlEr-Ny2MWkPn4rdB93VIVRG1H_sGgsA"

echo "🔨 Step 1: Setting up DAML SDK path..."
export PATH="$HOME/.daml/bin:$PATH"

echo "📦 Step 2: Building DAML contracts..."
cd daml
daml build
cd ..

DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"

if [ ! -f "$DAR_FILE" ]; then
  echo "❌ Error: DAR file not found at $DAR_FILE"
  exit 1
fi

echo "✅ DAR file built: $DAR_FILE"
echo ""

echo "📤 Step 3: Uploading DAR to Canton using gRPC..."

# Check if grpcurl is installed
if ! command -v grpcurl &> /dev/null; then
  echo "❌ Error: grpcurl is not installed"
  echo "Install with: brew install grpcurl (macOS)"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo "❌ Error: jq is not installed"
  echo "Install with: brew install jq (macOS)"
  exit 1
fi

# Base64 encode DAR file
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS (BSD base64)
  BASE64_DAR=$(base64 -i "$DAR_FILE" | tr -d '\n')
else
  # Linux (GNU base64)
  BASE64_DAR=$(base64 -w 0 "$DAR_FILE")
fi

# Prepare gRPC request
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

# Upload DAR using gRPC (use TLS for port 443)
echo "Sending gRPC request..."
RESPONSE=$(echo "$GRPC_REQUEST" | timeout 30 grpcurl \
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
  echo "🎉 Deployment complete!"
  echo ""
  echo "Next step: Create OrderBooks"
  echo "  cd backend && npm run init-orderbooks"
else
  echo "❌ Upload failed"
  echo "Error:"
  echo "$RESPONSE"
  exit 1
fi

