#!/bin/bash

# DEBUG VERSION - PRINTS ERROR DETAILS
CLIENT_ID="snp3u6udkFF983rfprvsBbx3X3mBpw"
CLIENT_SECRET="l5Td3OUSanQoGeNMWg2nnPxq1VYc"
TOKEN_URL="https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token"

echo "🔐 Fetching Admin Token..."

# 1. Capture the full response
response=$(curl -k -s -X POST $TOKEN_URL \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "scope=daml_ledger_api")

# 2. Print the response for debugging
echo "🔍 Debug - Keycloak Response:"
echo "$response"

# 3. Extract Token
jwt_token=$(echo $response | jq -r .access_token)

if [ "$jwt_token" == "null" ] || [ -z "$jwt_token" ]; then
  echo "❌ Failed to get token."
  exit 1
fi

echo "✅ Token received!"
# ... rest of the script is fine ...

# 2. CONFIGURATION
# Point directly to where 'daml build' creates the file
DAR_DIRECTORY=".daml/dist" 
PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443
canton_admin_api_url="${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}"
canton_admin_api_grpc_base_service="com.digitalasset.canton.admin.participant.v30"
canton_admin_api_grpc_package_service=${canton_admin_api_grpc_base_service}".PackageService"

json() {
  declare input=${1:-$(</dev/stdin)}
  printf '%s' "${input}" | jq -c .
}

upload_dar() {
  local dar_path=$1
  echo "📦 Uploading DAR to ledger: ${dar_path}"

  # MacOS/BSD base64 command
  local base64_encoded_dar=$(base64 -i "${dar_path}" | tr -d '\n')

  local grpc_upload_dar_request="{
    \"dars\": [{
      \"bytes\": \"${base64_encoded_dar}\"
    }],
    \"vet_all_packages\": true,
    \"synchronize_vetting\": true
  }"

  # Execute gRPC call
  echo "🚀 Executing gRPC upload..."
  grpcurl \
    -H "Authorization: Bearer ${jwt_token}" \
    -d @ \
    ${canton_admin_api_url} ${canton_admin_api_grpc_package_service}.UploadDar \
    < <(echo ${grpc_upload_dar_request} | json)

  if [ $? -eq 0 ]; then
    echo "✅ DAR uploaded successfully!"
  else
    echo "❌ DAR upload failed!"
    exit 1
  fi
}

# 3. EXECUTION
if [ -d ${DAR_DIRECTORY} ]; then
  # Find the .dar file automatically
  dar_file=$(find ${DAR_DIRECTORY} -name "*.dar" | head -n 1)
  
  if [ -z "$dar_file" ]; then
    echo "❌ No .dar file found in ${DAR_DIRECTORY}. Did you run 'daml build'?"
    exit 1
  fi

  echo "📁 Found DAR file: ${dar_file}"
  upload_dar "${dar_file}"
else
  echo "❌ Directory not found: ${DAR_DIRECTORY}"
  exit 1
fi
