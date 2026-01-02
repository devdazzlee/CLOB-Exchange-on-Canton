#!/bin/bash

# Quick setup script to configure JWT token for Canton API

echo "🔑 Setting up Canton API Authentication"
echo ""

# Get token from USE_JWT_TOKEN.sh if it exists
if [ -f "../USE_JWT_TOKEN.sh" ]; then
    echo "📋 Found USE_JWT_TOKEN.sh, extracting token..."
    TOKEN=$(grep '^JWT_TOKEN=' ../USE_JWT_TOKEN.sh | cut -d'"' -f2)
    
    if [ -n "$TOKEN" ]; then
        echo "✅ Token extracted"
        echo ""
        echo "Creating frontend/.env file..."
        echo "VITE_CANTON_JWT_TOKEN=$TOKEN" > frontend/.env
        echo "✅ Created frontend/.env with JWT token"
        echo ""
        echo "🚀 Now restart your frontend:"
        echo "   cd frontend && yarn dev"
        exit 0
    fi
fi

# If no token found, prompt user
echo "⚠️  No token found in USE_JWT_TOKEN.sh"
echo ""
echo "Please create frontend/.env manually:"
echo "   VITE_CANTON_JWT_TOKEN=your-jwt-token-here"
echo ""
echo "Or get token from Keycloak:"
echo "   https://keycloak.wolfedgelabs.com:8443"
echo "   Username: zoya"
echo "   Password: Zoya123!"

