#!/bin/bash

# DAR Upload Script - Using Password Grant Authentication
# This script uses username/password to get a token, then uploads the DAR

# ============================================================================
# CONFIGURATION
# ============================================================================

# Keycloak Configuration
KEYCLOAK_URL="https://keycloak.wolfedgelabs.com:8443"
KEYCLOAK_REALM="canton-devnet"

# Try multiple client IDs - some may grant daml_ledger_api scope
# Order matters: try most permissive first
CLIENT_IDS=("Clob" "account-console" "canton-client")

# User Credentials
USERNAME="zoya"
PASSWORD="Zoya123!"

# Canton Configuration
PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443
canton_admin_api_url="${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}"
canton_admin_api_grpc_base_service="com.digitalasset.canton.admin.participant.v30"
canton_admin_api_grpc_package_service=${canton_admin_api_grpc_base_service}".PackageService"

# DAR Configuration
DAR_DIRECTORY=".daml/dist"

# ============================================================================
# STEP 1: GET TOKEN VIA PASSWORD GRANT
# ============================================================================

echo "🔐 Authenticating with Keycloak (Password Grant)..."
echo "   Username: ${USERNAME}"
echo ""

TOKEN_URL="${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"

# Try each client ID until we get a token with daml_ledger_api scope
jwt_token=""
used_client=""

for KEYCLOAK_CLIENT_ID in "${CLIENT_IDS[@]}"; do
  echo "   Trying client: ${KEYCLOAK_CLIENT_ID}..."
  
  # Get token using password grant
  # IMPORTANT: Request daml_ledger_api scope for DAR upload permissions
  response=$(curl -k -s -X POST "$TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=${KEYCLOAK_CLIENT_ID}" \
    -d "username=${USERNAME}" \
    -d "password=${PASSWORD}" \
    -d "scope=openid profile email daml_ledger_api")
  
  # Check for errors
  error=$(echo "$response" | jq -r '.error' 2>/dev/null)
  if [ "$error" != "null" ] && [ -n "$error" ]; then
    echo "      ❌ Failed: $error"
    continue
  fi
  
  # Extract token
  temp_token=$(echo "$response" | jq -r '.access_token' 2>/dev/null)
  
  if [ "$temp_token" != "null" ] && [ -n "$temp_token" ]; then
    # Check if token has daml_ledger_api scope
    token_payload=$(echo "$temp_token" | cut -d'.' -f2)
    padding=$((4 - ${#token_payload} % 4))
    if [ $padding -ne 4 ]; then
      token_payload="${token_payload}$(printf '%*s' $padding | tr ' ' '=')"
    fi
    decoded_scope=$(echo "$token_payload" | base64 -d 2>/dev/null | jq -r '.scope' 2>/dev/null)
    
    if [[ "$decoded_scope" == *"daml_ledger_api"* ]]; then
      jwt_token="$temp_token"
      used_client="$KEYCLOAK_CLIENT_ID"
      echo "      ✅ Success! Token has daml_ledger_api scope"
      break
    else
      echo "      ⚠️  Token received but missing daml_ledger_api scope"
      echo "         Scopes: $decoded_scope"
      # Keep trying other clients
    fi
  fi
done

if [ -z "$jwt_token" ]; then
  echo ""
  echo "❌ Failed to get token with daml_ledger_api scope from any client!"
  echo ""
  echo "Tried clients: ${CLIENT_IDS[*]}"
  echo ""
  echo "Possible solutions:"
  echo "  1. Check username/password are correct"
  echo "  2. Verify your account has permissions for daml_ledger_api scope"
  echo "  3. Contact admin to grant daml_ledger_api scope to your account"
  echo "  4. Try using a different client ID (edit script to add your client)"
  echo ""
  exit 1
fi

echo ""
echo "✅ Token received!"
echo "   Client used: ${used_client}"
echo "   Token preview: ${jwt_token:0:50}..."

# ============================================================================
# STEP 2: FIND DAR FILE
# ============================================================================

echo ""
echo "📦 Looking for DAR file..."

if [ ! -d "${DAR_DIRECTORY}" ]; then
  echo "❌ Directory not found: ${DAR_DIRECTORY}"
  echo "   Run 'daml build' first!"
  exit 1
fi

# Find the latest clob-exchange-splice DAR file
dar_file=$(find ${DAR_DIRECTORY} -name "clob-exchange-splice*.dar" | sort -r | head -n 1)

if [ -z "$dar_file" ]; then
  echo "❌ No clob-exchange-splice DAR file found in ${DAR_DIRECTORY}"
  echo "   Available DAR files:"
  ls -lh ${DAR_DIRECTORY}/*.dar 2>/dev/null || echo "   (none found)"
  echo ""
  echo "   Run 'daml build' to create the DAR file."
  exit 1
fi

echo "✅ Found DAR file: ${dar_file}"
file_size=$(ls -lh "$dar_file" | awk '{print $5}')
echo "   Size: ${file_size}"

# ============================================================================
# STEP 3: UPLOAD DAR VIA gRPC
# ============================================================================

echo ""
echo "🚀 Uploading DAR to Canton..."

# Helper function to create JSON
json() {
  declare input=${1:-$(</dev/stdin)}
  printf '%s' "${input}" | jq -c .
}

# Base64 encode the DAR file
echo "   Encoding DAR file to base64..."
base64_encoded_dar=$(base64 -i "${dar_file}" | tr -d '\n')

# Create gRPC request
grpc_upload_dar_request="{
  \"dars\": [{
    \"bytes\": \"${base64_encoded_dar}\"
  }],
  \"vet_all_packages\": true,
  \"synchronize_vetting\": true
}"

echo "   Sending gRPC request to ${canton_admin_api_url}..."

# Execute gRPC call
upload_result=$(grpcurl \
  -H "Authorization: Bearer ${jwt_token}" \
  -d @ \
  ${canton_admin_api_url} \
  ${canton_admin_api_grpc_package_service}.UploadDar \
  < <(echo ${grpc_upload_dar_request} | json) 2>&1)

upload_exit_code=$?

if [ $upload_exit_code -eq 0 ]; then
  echo ""
  echo "✅ DAR uploaded successfully!"
  echo ""
  echo "📋 Upload Result:"
  echo "$upload_result" | jq '.' 2>/dev/null || echo "$upload_result"
  echo ""
  echo "🎉 Your contracts are now deployed to Canton!"
  echo ""
  echo "Next steps:"
  echo "  1. Verify deployment (check package ID in response above)"
  echo "  2. Create MasterOrderBook contracts for trading pairs"
  echo "  3. Start the frontend and test order placement"
else
  echo ""
  echo "❌ DAR upload failed!"
  echo ""
  echo "Error details:"
  echo "$upload_result"
  echo ""
  echo "Possible issues:"
  echo "  1. Token expired or invalid"
  echo "  2. Token missing 'daml_ledger_api' scope"
  echo "  3. User doesn't have permission to upload packages"
  echo "  4. Network connectivity issue"
  echo "  5. Canton participant node is down"
  exit 1
fi
