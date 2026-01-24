#!/bin/bash

# DAR Upload Script - Uses Backend Admin Service
# This script leverages the backend's working CantonAdmin service to get the token
# This avoids authentication issues by using the same method the backend uses

echo "🔐 Getting Admin Token via Backend Service..."

# Change to backend directory to use the admin service
cd "$(dirname "$0")/backend" || exit 1

# Use Node.js to get the admin token from the backend's CantonAdmin service
ADMIN_TOKEN=$(node -e "
const CantonAdmin = require('./canton-admin');
const admin = new CantonAdmin();
admin.getAdminToken()
  .then(token => {
    console.log(token);
    process.exit(0);
  })
  .catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
")

if [ $? -ne 0 ] || [ -z "$ADMIN_TOKEN" ]; then
  echo "❌ Failed to get admin token from backend service"
  echo "💡 Make sure backend/.env has KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_CLIENT_SECRET set"
  exit 1
fi

echo "✅ Token received from backend service"

# Go back to project root
cd "$(dirname "$0")" || exit 1

# Configuration
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
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
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

# Find and upload DAR file
if [ -d ${DAR_DIRECTORY} ]; then
  dar_file=$(find ${DAR_DIRECTORY} -name "clob-exchange-splice*.dar" | head -n 1)
  
  if [ -z "$dar_file" ]; then
    echo "❌ No clob-exchange-splice DAR file found in ${DAR_DIRECTORY}"
    echo "💡 Run 'daml build' first"
    exit 1
  fi

  echo "📁 Found DAR file: ${dar_file}"
  upload_dar "${dar_file}"
else
  echo "❌ Directory not found: ${DAR_DIRECTORY}"
  exit 1
fi
