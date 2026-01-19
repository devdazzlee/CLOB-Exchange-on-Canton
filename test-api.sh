#!/bin/bash

# Test Canton JSON API v2 endpoints
# Usage: ./test-api.sh

set -e

JWT_TOKEN="${JWT_TOKEN:-}"
PARTY_ID="8100b2db-86cf-40a1-8351-55483c151cdc"
API_BASE="https://participant.dev.canton.wolfedgelabs.com/json-api/v2"

if [ -z "$JWT_TOKEN" ]; then
  echo "Error: JWT_TOKEN not set"
  echo "Usage: export JWT_TOKEN=\"your-token\" && ./test-api.sh"
  exit 1
fi

echo "=== Testing Canton JSON API v2 ==="
echo "Party ID: $PARTY_ID"
echo ""

# Test 1: MasterOrderBook
echo "1. Testing MasterOrderBook:"
curl -k -s -X POST "${API_BASE}/state/active-contracts" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"readAs\": [\"${PARTY_ID}\"],
    \"activeAtOffset\": \"0\",
    \"verbose\": true,
    \"filter\": {
      \"filtersByParty\": {
        \"${PARTY_ID}\": {
          \"inclusive\": {
            \"templateIds\": [\"MasterOrderBook:MasterOrderBook\"]
          }
        }
      }
    }
  }" | jq -r '.result.activeContracts | length' | xargs -I {} echo "   Found {} MasterOrderBook contracts"
echo ""

# Test 2: Order
echo "2. Testing Order:"
curl -k -s -X POST "${API_BASE}/state/active-contracts" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"readAs\": [\"${PARTY_ID}\"],
    \"activeAtOffset\": \"0\",
    \"verbose\": true,
    \"filter\": {
      \"filtersByParty\": {
        \"${PARTY_ID}\": {
          \"inclusive\": {
            \"templateIds\": [\"Order:Order\"]
          }
        }
      }
    }
  }" | jq -r '.result.activeContracts | length' | xargs -I {} echo "   Found {} Order contracts"
echo ""

# Test 3: UserAccount
echo "3. Testing UserAccount:"
curl -k -s -X POST "${API_BASE}/state/active-contracts" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"readAs\": [\"${PARTY_ID}\"],
    \"activeAtOffset\": \"0\",
    \"verbose\": true,
    \"filter\": {
      \"filtersByParty\": {
        \"${PARTY_ID}\": {
          \"inclusive\": {
            \"templateIds\": [\"UserAccount:UserAccount\"]
          }
        }
      }
    }
  }" | jq -r '.result.activeContracts | length' | xargs -I {} echo "   Found {} UserAccount contracts"
echo ""

# Test 4: Trade
echo "4. Testing Trade:"
curl -k -s -X POST "${API_BASE}/state/active-contracts" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"readAs\": [\"${PARTY_ID}\"],
    \"activeAtOffset\": \"0\",
    \"verbose\": true,
    \"filter\": {
      \"filtersByParty\": {
        \"${PARTY_ID}\": {
          \"inclusive\": {
            \"templateIds\": [\"Trade:Trade\"]
          }
        }
      }
    }
  }" | jq -r '.result.activeContracts | length' | xargs -I {} echo "   Found {} Trade contracts"
echo ""

# Test 5: List all packages
echo "5. Testing /v2/packages (list all packages):"
curl -k -s -X GET "${API_BASE}/packages" \
  -H "Authorization: Bearer ${JWT_TOKEN}" | jq -r '.packageIds | length' | xargs -I {} echo "   Found {} packages"
echo ""

echo "=== Test Complete ==="
