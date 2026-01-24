#!/bin/bash

# DAR Upload Script - Using Provided Token Directly
# This script uses a pre-obtained JWT token to upload the DAR

# ============================================================================
# CONFIGURATION
# ============================================================================

# Use the token you provided (or set via environment variable)
JWT_TOKEN="${JWT_TOKEN:-eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg4NDI2MzAsImlhdCI6MTc2ODg0MDgzMCwiYXV0aF90aW1lIjoxNzY4ODQwODE2LCJqdGkiOiJvbnJ0YWM6MmRlNTBmMmMtZDA1My1lNWE5LWY5MmUtZTMyNzE5MmRhYTJhIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiNTY1ZjQyZWQtMjE5Zi00MmMzLTk4NGYtNTQwMThkYTY2YmE2IiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.vuvZKq8uCQqljH0z5rwHqw-HpuBcPixSVoFj4SeM3_rCphbsml3fUx4vHxs2Dtw8ZFoGllrwwYJ5N99zIfKVzx91D4N2uhli5xgEdgq1T7ICkOQjG7uA3yUWDu6g_rpwBOvC5EBXNG5uhiosbUnfNX7pGhw-GYrhnYIKBqfZYcFspqFNmq-TYZCOEQEDvTrHiIxFFH1qEWoRyDBksS32ZLKmnpLV2NSCXoqm6gGHVL20WIiyeNPsnKXZpoCsdjmsXZha-l0ywukcjbxTOMcuW8uF_HClviCkQvAXD7w_Z9IBV1GFwuAUJsUcvFEUupLj0l2ubXhH3_1uF8yAftA_IQ}"

# Canton Configuration
PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443
canton_admin_api_url="${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}"
canton_admin_api_grpc_base_service="com.digitalasset.canton.admin.participant.v30"
canton_admin_api_grpc_package_service=${canton_admin_api_grpc_base_service}".PackageService"

# DAR Configuration
DAR_DIRECTORY=".daml/dist"

# ============================================================================
# VALIDATE TOKEN
# ============================================================================

echo "🔐 Using provided JWT token..."
echo "   Token preview: ${JWT_TOKEN:0:50}..."

# Decode and check token
token_payload=$(echo "$JWT_TOKEN" | cut -d'.' -f2)
# Add padding if needed for base64 decode
padding=$((4 - ${#token_payload} % 4))
if [ $padding -ne 4 ]; then
  token_payload="${token_payload}$(printf '%*s' $padding | tr ' ' '=')"
fi

decoded_payload=$(echo "$token_payload" | base64 -d 2>/dev/null)
scope=$(echo "$decoded_payload" | jq -r '.scope' 2>/dev/null)
exp=$(echo "$decoded_payload" | jq -r '.exp' 2>/dev/null)

echo ""
echo "🔍 Token Information:"
echo "   Scopes: $scope"
if [ -n "$exp" ]; then
  exp_date=$(date -r "$exp" 2>/dev/null || date -d "@$exp" 2>/dev/null)
  echo "   Expires: $exp_date"
  
  current_time=$(date +%s)
  if [ "$exp" -lt "$current_time" ]; then
    echo ""
    echo "❌ Token has expired!"
    echo "   Please get a fresh token or use upload-dar-password-grant.sh"
    exit 1
  fi
fi

# Check for daml_ledger_api scope
if [[ ! "$scope" == *"daml_ledger_api"* ]]; then
  echo ""
  echo "⚠️  WARNING: Token does not have 'daml_ledger_api' scope!"
  echo "   Current scopes: $scope"
  echo "   The upload may fail with 403 Forbidden."
  echo ""
  echo "💡 Solution: Use upload-dar-password-grant.sh instead"
  echo "   It will request a token with the correct scope."
  echo ""
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# ============================================================================
# FIND DAR FILE
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
# UPLOAD DAR VIA gRPC
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
  -H "Authorization: Bearer ${JWT_TOKEN}" \
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
else
  echo ""
  echo "❌ DAR upload failed!"
  echo ""
  echo "Error details:"
  echo "$upload_result"
  echo ""
  
  # Check for specific errors
  if echo "$upload_result" | grep -q "403\|Forbidden\|Unauthorized"; then
    echo "💡 This looks like a permissions issue."
    echo "   Your token may be missing 'daml_ledger_api' scope."
    echo "   Try using: ./upload-dar-password-grant.sh"
  elif echo "$upload_result" | grep -q "expired\|Expired"; then
    echo "💡 Token has expired. Get a fresh token or use password grant script."
  fi
  
  exit 1
fi
