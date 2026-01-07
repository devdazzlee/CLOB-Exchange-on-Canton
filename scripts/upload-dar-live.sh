#!/bin/bash

# Upload DAR file to Canton participant node (LIVE DEPLOYMENT)
# Based on client-provided script and configuration
# Usage: ./scripts/upload-dar-live.sh

set -e

# Configuration from client
DAR_DIRECTORY="./dars"
JWT_TOKEN="${JWT_TOKEN:-}"
PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443
canton_admin_api_url="${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}"
canton_admin_api_grpc_base_service="com.digitalasset.canton.admin.participant.v30"
canton_admin_api_grpc_package_service=${canton_admin_api_grpc_base_service}".PackageService"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== CLOB Exchange - Live Deployment ===${NC}\n"
echo -e "${GREEN}Uploading DAR file to Canton participant node${NC}\n"

# Check if JWT token is set
if [ -z "$JWT_TOKEN" ]; then
  echo -e "${YELLOW}⚠ Warning: JWT_TOKEN not set${NC}"
  echo ""
  echo "Please set JWT_TOKEN environment variable:"
  echo "  export JWT_TOKEN='your-jwt-token-here'"
  echo ""
  echo "Or run:"
  echo "  JWT_TOKEN='your-token' ./scripts/upload-dar-live.sh"
  echo ""
  read -p "Do you want to continue without JWT token? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check if grpcurl is installed
if ! command -v grpcurl &> /dev/null; then
  echo -e "${RED}✗ Error: grpcurl is not installed${NC}"
  echo ""
  echo "Install grpcurl:"
  echo "  macOS: brew install grpcurl"
  echo "  Linux: apt-get install grpcurl"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo -e "${RED}✗ Error: jq is not installed${NC}"
  echo ""
  echo "Install jq:"
  echo "  macOS: brew install jq"
  echo "  Linux: apt-get install jq"
  exit 1
fi

# Find DAR file
DAR_FILE=""
if [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
  DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
elif [ -f "daml/.daml/dist/clob-exchange-1.0.0.dar" ]; then
  DAR_FILE="daml/.daml/dist/clob-exchange-1.0.0.dar"
else
  echo -e "${RED}✗ Error: DAR file not found${NC}"
  echo ""
  echo "Please build the DAML project first:"
  echo "  cd daml && daml build"
  exit 1
fi

echo -e "${GREEN}✓ Found DAR file: ${DAR_FILE}${NC}\n"

# Create dars directory if it doesn't exist
mkdir -p "$DAR_DIRECTORY"

# Copy DAR file to dars directory
DAR_NAME=$(basename "$DAR_FILE")
cp "$DAR_FILE" "$DAR_DIRECTORY/$DAR_NAME"
echo -e "${GREEN}✓ Copied DAR file to ${DAR_DIRECTORY}/${DAR_NAME}${NC}\n"

# JSON helper function
json() {
  declare input=${1:-$(</dev/stdin)}
  printf '%s' "${input}" | jq -c .
}

# Upload DAR function
upload_dar() {
  local dar_directory=$1
  local dar=$2
  echo -e "${BLUE}Uploading DAR to ledger: ${dar}${NC}"

  # Base64 encode DAR file
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS (BSD base64)
    local base64_encoded_dar=$(base64 -i ${dar_directory}/${dar} | tr -d '\n')
  else
    # Linux (GNU base64)
    local base64_encoded_dar=$(base64 -w 0 ${dar_directory}/${dar})
  fi

  local grpc_upload_dar_request="{
    \"dars\": [{
      \"bytes\": \"${base64_encoded_dar}\"
    }],
    \"vet_all_packages\": true,
    \"synchronize_vetting\": true
  }"

  echo "Sending request to ${canton_admin_api_url}..."
  echo ""

  # Upload using gRPC
  if [ -z "$JWT_TOKEN" ]; then
    RESPONSE=$(echo ${grpc_upload_dar_request} | json | grpcurl \
      -plaintext \
      -d @ \
      ${canton_admin_api_url} \
      ${canton_admin_api_grpc_package_service}.UploadDar 2>&1)
  else
    RESPONSE=$(echo ${grpc_upload_dar_request} | json | grpcurl \
      -H "Authorization: Bearer ${JWT_TOKEN}" \
      -d @ \
      ${canton_admin_api_url} \
      ${canton_admin_api_grpc_package_service}.UploadDar 2>&1)
  fi

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ DAR '${dar}' successfully uploaded!${NC}"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    return 0
  else
    echo -e "${RED}✗ Failed to upload DAR '${dar}'${NC}"
    echo ""
    echo "Error:"
    echo "$RESPONSE"
    return 1
  fi
}

# Upload the DAR file
if upload_dar ${DAR_DIRECTORY} ${DAR_NAME}; then
  echo ""
  echo -e "${GREEN}=== Deployment Complete! ===${NC}\n"
  echo "Next steps:"
  echo ""
  echo "1. Verify contracts are deployed:"
  echo "   curl -X POST https://${PARTICIPANT_HOST}/json-api/v1/query \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"templateIds\": [\"UserAccount:UserAccount\"]}'"
  echo ""
  echo "2. Test frontend connection:"
  echo "   - Start frontend: cd frontend && npm run dev"
  echo "   - Open: http://localhost:3000"
  echo ""
  echo "3. Create initial OrderBook contracts using the frontend"
  echo ""
  echo "4. Test order placement and matching"
  echo ""
  echo -e "${GREEN}✅ CLOB Exchange is now live on Canton!${NC}"
else
  echo ""
  echo -e "${RED}=== Deployment Failed ===${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "1. Check JWT token is valid"
  echo "2. Verify network connectivity to ${PARTICIPANT_HOST}"
  echo "3. Check Canton participant node is running"
  echo "4. Review error message above"
  exit 1
fi





