#!/bin/bash

# Get Package ID from deployed contracts
# Usage: ./scripts/get-package-id.sh [jwt-token]

set -e

JWT_TOKEN="${1:-${JWT_TOKEN:-}}"
PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
API_BASE="https://${PARTICIPANT_HOST}/json-api"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Getting Package ID from Ledger ===${NC}\n"

# Try to query with unqualified template ID
# Ledger will return fully qualified templateId
QUERY_PAYLOAD='{
  "activeAtOffset": "0",
  "verbose": false,
  "filter": {
    "filtersForAnyParty": {
      "inclusive": {
        "templateIds": ["UserAccount:UserAccount"]
      }
    }
  }
}'

echo "Querying ledger for contracts..."
echo ""

if [ -z "$JWT_TOKEN" ]; then
  RESPONSE=$(curl -s -X POST "${API_BASE}/v2/state/active-contracts" \
    -H "Content-Type: application/json" \
    -d "$QUERY_PAYLOAD" 2>&1)
else
  RESPONSE=$(curl -s -X POST "${API_BASE}/v2/state/active-contracts" \
    -H "Authorization: Bearer ${JWT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$QUERY_PAYLOAD" 2>&1)
fi

# Check if response contains templateId
if echo "$RESPONSE" | grep -q "templateId"; then
  # Extract package ID from templateId
  # Format: <package-id>:<module>:<template>
  PACKAGE_ID=$(echo "$RESPONSE" | jq -r '.activeContracts[0].templateId' 2>/dev/null | cut -d':' -f1)
  
  if [ -n "$PACKAGE_ID" ] && [ "$PACKAGE_ID" != "null" ]; then
    echo -e "${GREEN}✓ Package ID found: ${PACKAGE_ID}${NC}\n"
    echo "$PACKAGE_ID"
    
    # Also try OrderBook if UserAccount not found
  else
    echo -e "${YELLOW}No UserAccount found, trying OrderBook...${NC}\n"
    
    ORDERBOOK_PAYLOAD='{
      "activeAtOffset": "0",
      "verbose": false,
      "filter": {
        "filtersForAnyParty": {
          "inclusive": {
            "templateIds": ["OrderBook:OrderBook"]
          }
        }
      }
    }'
    
    if [ -z "$JWT_TOKEN" ]; then
      ORDERBOOK_RESPONSE=$(curl -s -X POST "${API_BASE}/v2/state/active-contracts" \
        -H "Content-Type: application/json" \
        -d "$ORDERBOOK_PAYLOAD" 2>&1)
    else
      ORDERBOOK_RESPONSE=$(curl -s -X POST "${API_BASE}/v2/state/active-contracts" \
        -H "Authorization: Bearer ${JWT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$ORDERBOOK_PAYLOAD" 2>&1)
    fi
    
    PACKAGE_ID=$(echo "$ORDERBOOK_RESPONSE" | jq -r '.activeContracts[0].templateId' 2>/dev/null | cut -d':' -f1)
    
    if [ -n "$PACKAGE_ID" ] && [ "$PACKAGE_ID" != "null" ]; then
      echo -e "${GREEN}✓ Package ID found from OrderBook: ${PACKAGE_ID}${NC}\n"
      echo "$PACKAGE_ID"
    else
      echo -e "${RED}✗ Could not determine package ID${NC}"
      echo "Response: $RESPONSE"
      exit 1
    fi
  fi
else
  echo -e "${RED}✗ Error querying ledger${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi



