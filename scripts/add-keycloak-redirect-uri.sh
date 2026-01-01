#!/bin/bash

# Script to add redirect URI to Keycloak using Admin REST API
# This is a programmatic way to add the redirect URI without manual steps

KEYCLOAK_URL="https://keycloak.wolfedgelabs.com:8443"
REALM="canton-devnet"
CLIENT_ID="4roh9X7y4TyT89feJu7AnM2sMZbR9xh7"
REDIRECT_URI="http://localhost:3000/auth/callback"

ADMIN_USERNAME="zoya"
ADMIN_PASSWORD="Zoya123!"

echo "🔧 Adding redirect URI to Keycloak client..."
echo "   Client ID: $CLIENT_ID"
echo "   Redirect URI: $REDIRECT_URI"
echo ""

# Step 1: Get admin token (try realm-specific first, then master)
echo "1. Getting admin token..."
ADMIN_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/$REALM/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=$ADMIN_USERNAME" \
  -d "password=$ADMIN_PASSWORD" 2>/dev/null | jq -r '.access_token' 2>/dev/null)

# If that fails, try master realm
if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
  ADMIN_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" \
    -d "username=$ADMIN_USERNAME" \
    -d "password=$ADMIN_PASSWORD" 2>/dev/null | jq -r '.access_token' 2>/dev/null)
fi

if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
  echo "❌ Failed to get admin token. Check credentials."
  exit 1
fi

echo "   ✅ Admin token obtained"
echo ""

# Step 2: Get client UUID
echo "2. Finding client..."
CLIENTS_RESPONSE=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM/clients?clientId=$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json")

# Check if response is an array
if echo "$CLIENTS_RESPONSE" | jq -e '. | type == "array"' > /dev/null 2>&1; then
  CLIENT_UUID=$(echo "$CLIENTS_RESPONSE" | jq -r '.[0].id' 2>/dev/null)
else
  # Try as single object
  CLIENT_UUID=$(echo "$CLIENTS_RESPONSE" | jq -r '.id' 2>/dev/null)
fi

if [ -z "$CLIENT_UUID" ] || [ "$CLIENT_UUID" = "null" ]; then
  echo "❌ Client not found"
  exit 1
fi

echo "   ✅ Client found (UUID: $CLIENT_UUID)"
echo ""

# Step 3: Get current client configuration
echo "3. Getting current client configuration..."
CLIENT_CONFIG=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json")

CURRENT_URIS=$(echo "$CLIENT_CONFIG" | jq -r '.redirectUris[]' 2>/dev/null || echo "")

echo "   Current redirect URIs:"
if [ -z "$CURRENT_URIS" ]; then
  echo "     (none)"
else
  echo "$CURRENT_URIS" | while read uri; do
    echo "     ✓ $uri"
  done
fi
echo ""

# Step 4: Check if redirect URI already exists
if echo "$CURRENT_URIS" | grep -q "^$REDIRECT_URI$"; then
  echo "✅ Redirect URI already exists: $REDIRECT_URI"
  exit 0
fi

# Step 5: Add redirect URI
echo "4. Adding redirect URI..."
UPDATED_URIS=$(echo "$CLIENT_CONFIG" | jq --arg uri "$REDIRECT_URI" '.redirectUris += [$uri]')

RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$KEYCLOAK_URL/admin/realms/$REALM/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$UPDATED_URIS")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
  echo "   ✅ Redirect URI added successfully!"
  echo ""
  echo "🎉 Done! You can now use OAuth login."
else
  echo "   ❌ Failed to add redirect URI"
  echo "   HTTP Code: $HTTP_CODE"
  echo "   Response: $BODY"
  exit 1
fi

