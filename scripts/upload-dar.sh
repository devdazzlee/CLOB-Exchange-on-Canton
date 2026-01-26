#!/bin/bash

# Upload DAR file to Canton participant node
# Usage: ./scripts/upload-dar.sh [path-to-dar-file]

set -e

# Configuration
DAR_FILE="${1:-daml/.daml/dist/clob-exchange-1.0.0.dar}"
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

# Base64 encode DAR file to temporary file
echo "Encoding DAR file..."
TEMP_BASE64_FILE=$(mktemp)
trap "rm -f $TEMP_BASE64_FILE" EXIT

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS (BSD base64)
  base64 -i "$DAR_DIRECTORY/$DAR_NAME" | tr -d '\n' > "$TEMP_BASE64_FILE"
else
  # Linux (GNU base64)
  base64 -w 0 "$DAR_DIRECTORY/$DAR_NAME" > "$TEMP_BASE64_FILE"
fi

# Prepare gRPC request using file input to avoid argument length limit
# If package already exists, set vet_all_packages to false to skip vetting
# This allows uploading even if a package with the same name/version exists
GRPC_UPLOAD_DAR_REQUEST=$(jq -n \
  --rawfile bytes "$TEMP_BASE64_FILE" \
  '{
    "dars": [{
      "bytes": $bytes
    }],
    "vet_all_packages": false,
    "synchronize_vetting": false
  }')

echo "Uploading DAR to Canton participant..."
echo ""

# Upload DAR using gRPC
# Port 443 requires TLS, so we MUST use -insecure (not -plaintext)
# -insecure skips certificate verification (OK for devnet)
echo "Uploading DAR to Canton participant..."
echo "Using TLS (port 443 requires TLS)..."
echo ""

# Use a temp file for the request to avoid pipe issues
TEMP_REQUEST_FILE=$(mktemp)
echo "$GRPC_UPLOAD_DAR_REQUEST" > "$TEMP_REQUEST_FILE"
trap "rm -f $TEMP_REQUEST_FILE $TEMP_BASE64_FILE" EXIT

# Run grpcurl directly with timeout
echo "Connecting to ${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}..."
echo "Uploading DAR file (this may take 30-60 seconds for large files)..."
echo ""

# Disable exit on error temporarily to capture the response
set +e

if [ -z "$JWT_TOKEN" ]; then
  RESPONSE=$(grpcurl \
    -insecure \
    -max-time 120 \
    -d @ \
    "${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}" \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar < "$TEMP_REQUEST_FILE" 2>&1)
else
  RESPONSE=$(grpcurl \
    -insecure \
    -max-time 120 \
    -H "Authorization: Bearer ${JWT_TOKEN}" \
    -d @ \
    "${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}" \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar < "$TEMP_REQUEST_FILE" 2>&1)
fi

GRPC_EXIT_CODE=$?
set -e

# Cleanup
rm -f "$TEMP_REQUEST_FILE"
trap - EXIT

# Check if upload was successful
if [ $GRPC_EXIT_CODE -eq 0 ]; then
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
  echo -e "${RED}✗ Upload failed (exit code: $GRPC_EXIT_CODE)${NC}"
  echo ""
  echo "Error details:"
  echo "$RESPONSE"
  echo ""
  
  # Provide troubleshooting based on error
  if [ $GRPC_EXIT_CODE -eq 124 ] || echo "$RESPONSE" | grep -qi "timeout\|timed out"; then
    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo "1. Connection timed out - the server may not be responding"
    echo "2. Check network connectivity: ping ${PARTICIPANT_HOST}"
    echo "3. Check if port is accessible: nc -zv ${PARTICIPANT_HOST} ${CANTON_ADMIN_GRPC_PORT}"
    echo "4. The server might be overloaded - try again later"
  elif echo "$RESPONSE" | grep -qi "unauthorized\|401\|403\|permission\|forbidden"; then
    echo -e "${YELLOW}Authentication Error:${NC}"
    echo "1. Your token might be expired or invalid"
    echo "2. The token might not have permission to upload DAR files"
    echo "3. Get a fresh token from the Wallet UI"
    echo "4. Check if the token is correctly formatted"
  elif echo "$RESPONSE" | grep -qi "connection refused\|refused"; then
    echo -e "${YELLOW}Connection Error:${NC}"
    echo "1. The server is not accepting connections"
    echo "2. Check if the participant host is correct"
    echo "3. Verify the port (443) is correct"
  fi
  
  exit 1
fi

