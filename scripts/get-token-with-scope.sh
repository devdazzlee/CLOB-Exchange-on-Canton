#!/bin/bash

# Get a JWT token with daml_ledger_api scope using password grant
# Usage: ./scripts/get-token-with-scope.sh

set -e

KEYCLOAK_URL="https://keycloak.wolfedgelabs.com:8443"
KEYCLOAK_REALM="canton-devnet"
USERNAME="${KEYCLOAK_USERNAME:-zoya}"
PASSWORD="${KEYCLOAK_PASSWORD:-Zoya123!}"

# Try multiple client IDs that might work
CLIENT_IDS=("4roh9X7y4TyT89feJu7AnM2sMZbR9xh7" "Clob" "account-console" "canton-client")

TOKEN_URL="${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"

echo "🔐 Getting JWT token with daml_ledger_api scope..."
echo "   Username: ${USERNAME}"
echo ""

for CLIENT_ID in "${CLIENT_IDS[@]}"; do
  echo "Trying client: ${CLIENT_ID}..."
  
  response=$(curl -k -s -X POST "$TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=${CLIENT_ID}" \
    -d "username=${USERNAME}" \
    -d "password=${PASSWORD}" \
    -d "scope=openid profile email daml_ledger_api")
  
  error=$(echo "$response" | jq -r '.error' 2>/dev/null)
  if [ "$error" != "null" ] && [ -n "$error" ]; then
    echo "   ❌ Failed: $error"
    continue
  fi
  
  access_token=$(echo "$response" | jq -r '.access_token' 2>/dev/null)
  scope=$(echo "$response" | jq -r '.scope' 2>/dev/null)
  
  if [ "$access_token" != "null" ] && [ -n "$access_token" ]; then
    echo "   ✅ Success!"
    echo ""
    echo "Token:"
    echo "$access_token"
    echo ""
    echo "Scope: $scope"
    echo ""
    echo "To use this token:"
    echo "  export JWT_TOKEN=\"$access_token\""
    echo "  ./scripts/upload-dar.sh"
    echo ""
    
    # Check if scope includes daml_ledger_api
    if [[ "$scope" == *"daml_ledger_api"* ]]; then
      echo "✅ Token includes 'daml_ledger_api' scope - ready for DAR upload!"
    else
      echo "⚠️  WARNING: Token does NOT include 'daml_ledger_api' scope"
      echo "   Current scope: $scope"
    fi
    
    exit 0
  fi
done

echo "❌ Failed to get token with any client ID"
exit 1
