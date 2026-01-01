#!/bin/bash

# Setup script for CLOB Exchange - Milestone 1
# This script sets up DAML PATH and tests the build

set -e

echo "🔧 Setting up CLOB Exchange..."

# Add DAML to PATH
export PATH="$HOME/.daml/bin:$PATH"

# Check DAML installation
if ! command -v daml &> /dev/null; then
    echo "❌ DAML SDK not found. Please install DAML SDK 2.9.3"
    echo "   See: INSTALL_DAML_SDK.md"
    exit 1
fi

echo "✅ DAML SDK found: $(daml version | head -1)"

# Build DAML contracts
echo ""
echo "📦 Building DAML contracts..."
cd daml
if daml build 2>&1 | tee ../daml-build.log | grep -q "DAR file created"; then
    echo "✅ DAML contracts built successfully!"
    echo "   DAR file: .daml/dist/clob-exchange-1.0.0.dar"
else
    echo "❌ DAML build failed. Check daml-build.log for details"
    exit 1
fi
cd ..

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
    echo "✅ Frontend dependencies installed"
else
    echo "✅ Frontend dependencies already installed"
fi
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the frontend:"
echo "  cd frontend && npm run dev"![1767214828776](image/setup-and-test/1767214828776.png)
echo ""
echo "To build DAML contracts:"
echo "  export PATH=\"\$HOME/.daml/bin:\$PATH\""
echo "  cd daml && daml build"



