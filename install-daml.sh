#!/bin/bash

# Bash script to install DAML SDK 2.9.3 (for Git Bash on Windows)
# Run: bash install-daml.sh

echo "🚀 DAML SDK 2.9.3 Installation Script"
echo "====================================="
echo ""

# Check Java
echo "1. Checking Java installation..."
if command -v java &> /dev/null; then
    JAVA_VERSION=$(java -version 2>&1 | head -n 1)
    echo "   ✅ Java found: $JAVA_VERSION"
else
    echo "   ❌ Java not found!"
    echo "   Please install JDK 11+ from: https://adoptium.net/"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Download URL
DAML_VERSION="2.9.3"
DOWNLOAD_URL="https://github.com/digital-asset/daml/releases/download/v${DAML_VERSION}/daml-sdk-${DAML_VERSION}-windows.exe"
INSTALLER_PATH="/tmp/daml-sdk-installer.exe"

echo ""
echo "2. Downloading DAML SDK ${DAML_VERSION}..."
echo "   URL: ${DOWNLOAD_URL}"

if command -v curl &> /dev/null; then
    curl -L -o "$INSTALLER_PATH" "$DOWNLOAD_URL"
elif command -v wget &> /dev/null; then
    wget -O "$INSTALLER_PATH" "$DOWNLOAD_URL"
else
    echo "   ❌ Neither curl nor wget found!"
    echo "   Please download manually from:"
    echo "   https://github.com/digital-asset/daml/releases/tag/v${DAML_VERSION}"
    exit 1
fi

if [ -f "$INSTALLER_PATH" ]; then
    echo "   ✅ Download complete"
else
    echo "   ❌ Download failed"
    exit 1
fi

echo ""
echo "3. Installation Instructions:"
echo "   ⚠️  On Windows, you need to run the installer manually:"
echo "   File: $INSTALLER_PATH"
echo ""
echo "   Or download from:"
echo "   https://github.com/digital-asset/daml/releases/tag/v${DAML_VERSION}"
echo ""
echo "   After installation:"
echo "   1. Close and reopen your terminal"
echo "   2. Run: daml version"
echo "   3. Should display: ${DAML_VERSION}"
echo ""

# Try to open installer (Windows)
if command -v cmd.exe &> /dev/null; then
    echo "   Attempting to open installer..."
    cmd.exe //c start "$INSTALLER_PATH" 2>/dev/null || true
fi

echo ""
echo "✅ Script complete!"
echo ""

