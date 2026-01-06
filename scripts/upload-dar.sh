#!/bin/bash

# Upload DAR file to Canton participant node
# Usage: ./scripts/upload-dar.sh [path-to-dar-file]

set -e

# Configuration
DAR_FILE="${1:-.daml/dist/clob-exchange-1.0.0.dar}"
JWT_TOKEN="${JWT_TOKEN:-}"
PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443
DAR_DIRECTORY="./dars"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== CLOB Exchange DAR Upload Script ===${NC}\n"

# Check if JWT token is set
if [ -z "$JWT_TOKEN" ]; then
  echo -e "${YELLOW}Warning: JWT_TOKEN not set. Using empty token.${NC}"
  echo "Set JWT_TOKEN environment variable if authentication is required."
  echo ""
fi

# Check if DAR file exists
if [ ! -f "$DAR_FILE" ]; then
  echo -e "${RED}Error: DAR file not found: $DAR_FILE${NC}"
  echo "Please build the DAML project first: cd daml && daml build"
  exit 1
fi

echo "DAR File: $DAR_FILE"
echo "Participant: $PARTICIPANT_HOST:$CANTON_ADMIN_GRPC_PORT"
echo ""

# Check if grpcurl is installed
if ! command -v grpcurl &> /dev/null; then
  echo -e "${RED}Error: grpcurl is not installed${NC}"
  echo "Install with: brew install grpcurl (macOS) or apt-get install grpcurl (Linux)"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq is not installed${NC}"
  echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# Create dars directory if it doesn't exist
mkdir -p "$DAR_DIRECTORY"

# Copy DAR file to dars directory
DAR_NAME=$(basename "$DAR_FILE")
cp "$DAR_FILE" "$DAR_DIRECTORY/$DAR_NAME"
echo -e "${GREEN}✓ Copied DAR file to $DAR_DIRECTORY/$DAR_NAME${NC}"

# Base64 encode DAR file
echo "Encoding DAR file..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS (BSD base64)
  BASE64_ENCODED_DAR=$(base64 -i "$DAR_DIRECTORY/$DAR_NAME" | tr -d '\n')
else
  # Linux (GNU base64)
  BASE64_ENCODED_DAR=$(base64 -w 0 "$DAR_DIRECTORY/$DAR_NAME")
fi

# Prepare gRPC request
GRPC_UPLOAD_DAR_REQUEST=$(jq -n \
  --arg bytes "$BASE64_ENCODED_DAR" \
  '{
    "dars": [{
      "bytes": $bytes
    }],
    "vet_all_packages": true,
    "synchronize_vetting": true
  }')

echo "Uploading DAR to Canton participant..."
echo ""

# Upload DAR using gRPC
if [ -z "$JWT_TOKEN" ]; then
  RESPONSE=$(echo "$GRPC_UPLOAD_DAR_REQUEST" | grpcurl \
    -plaintext \
    -d @ \
    "${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}" \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1)
else
  RESPONSE=$(echo "$GRPC_UPLOAD_DAR_REQUEST" | grpcurl \
    -H "Authorization: Bearer ${JWT_TOKEN}" \
    -d @ \
    "${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}" \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1)
fi

# Check if upload was successful
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ DAR file uploaded successfully!${NC}"
  echo ""
  echo "Response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  echo ""
  echo -e "${GREEN}✅ Deployment complete!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Verify contracts are available:"
  echo "   curl -X POST https://${PARTICIPANT_HOST}/json-api/v1/query \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"templateIds\": [\"UserAccount:UserAccount\"]}'"
  echo ""
  echo "2. Create initial OrderBook contracts using the frontend"
  echo "3. Test order placement and matching"
else
  echo -e "${RED}✗ Upload failed${NC}"
  echo "Error:"
  echo "$RESPONSE"
  exit 1
fi




