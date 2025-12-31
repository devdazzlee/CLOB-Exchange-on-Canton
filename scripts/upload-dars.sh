#!/bin/bash

# Upload DAR files to Canton participant node
# Based on provided upload-dars script
# Usage: ./scripts/upload-dars.sh

set -e

# Configuration
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
NC='\033[0m'

echo -e "${GREEN}=== Uploading DAR Files to Canton ===${NC}\n"

# Check if JWT token is set
if [ -z "$JWT_TOKEN" ]; then
  echo -e "${YELLOW}Warning: JWT_TOKEN not set.${NC}"
  echo "Set JWT_TOKEN environment variable if authentication is required."
  echo "Example: export JWT_TOKEN='your-token-here'"
  echo ""
fi

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

json() {
  declare input=${1:-$(</dev/stdin)}
  printf '%s' "${input}" | jq -c .
}

upload_dar() {
  local dar_directory=$1
  local dar=$2
  echo "Uploading DAR to ledger: ${dar}"

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
  
  if [ -z "$JWT_TOKEN" ]; then
    RESPONSE=$(echo ${grpc_upload_dar_request} | json | grpcurl \
      -plaintext \
      -d @ \
      ${canton_admin_api_url} ${canton_admin_api_grpc_package_service}.UploadDar 2>&1)
  else
    RESPONSE=$(echo ${grpc_upload_dar_request} | json | grpcurl \
      -H "Authorization: Bearer ${JWT_TOKEN}" \
      -d @ \
      ${canton_admin_api_url} ${canton_admin_api_grpc_package_service}.UploadDar 2>&1)
  fi

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ DAR '${dar}' successfully uploaded${NC}"
    echo ""
  else
    echo -e "${RED}✗ Failed to upload DAR '${dar}'${NC}"
    echo "Error: $RESPONSE"
    return 1
  fi
}

# Check if DAR directory exists, if not try to copy from build
if [ ! -d ${DAR_DIRECTORY} ]; then
  echo "DAR directory not found. Checking for built DAR files..."
  
  if [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
    echo "Found DAR file in .daml/dist/, copying to ${DAR_DIRECTORY}..."
    mkdir -p ${DAR_DIRECTORY}
    cp .daml/dist/clob-exchange-1.0.0.dar ${DAR_DIRECTORY}/
    echo -e "${GREEN}✓ DAR file copied${NC}\n"
  else
    echo -e "${RED}Error: DAR directory not found and no DAR file in .daml/dist/${NC}"
    echo "Please build the DAML project first: cd daml && daml build"
    exit 1
  fi
fi

# Upload all dars from the specified directory
if [ -d ${DAR_DIRECTORY} ]; then
  # List all .dar files in the directory
  dars=$(ls "${DAR_DIRECTORY}"/*.dar 2>/dev/null || echo "")
  
  if [ -z "$dars" ]; then
    echo -e "${RED}Error: No DAR files found in ${DAR_DIRECTORY}${NC}"
    exit 1
  fi
  
  echo "Found DAR files:"
  echo "$dars" | xargs -n1 basename
  echo ""
  
  # Loop over each dar file
  for dar_path in ${dars}; do
    dar=$(basename "$dar_path")
    upload_dar ${DAR_DIRECTORY} ${dar}
  done
  
  echo -e "${GREEN}=== Upload Complete ===${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Verify contracts are available:"
  echo "   curl -X POST https://${PARTICIPANT_HOST}/json-api/v1/query \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"templateIds\": [\"UserAccount:UserAccount\"]}'"
  echo ""
  echo "2. Test frontend connection"
  echo "3. Create initial OrderBook contracts"
else
  echo -e "${RED}Error: Directory not found: ${DAR_DIRECTORY}${NC}"
  exit 1
fi

