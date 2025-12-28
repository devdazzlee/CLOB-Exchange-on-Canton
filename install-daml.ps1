# PowerShell script to download and install DAML SDK 2.9.3 on Windows
# Run as Administrator: Right-click → "Run with PowerShell"

Write-Host "🚀 DAML SDK 2.9.3 Installation Script" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  Warning: Not running as Administrator" -ForegroundColor Yellow
    Write-Host "   Some steps may require admin privileges" -ForegroundColor Yellow
    Write-Host ""
}

# Check Java
Write-Host "1. Checking Java installation..." -ForegroundColor Yellow
try {
    $javaVersion = java -version 2>&1 | Select-String "version"
    Write-Host "   ✅ Java found: $javaVersion" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Java not found!" -ForegroundColor Red
    Write-Host "   Please install JDK 11+ from: https://adoptium.net/" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

# Download URL
$damlVersion = "2.9.3"
$downloadUrl = "https://github.com/digital-asset/daml/releases/download/v$damlVersion/daml-sdk-$damlVersion-windows.exe"
$installerPath = "$env:TEMP\daml-sdk-installer.exe"

Write-Host ""
Write-Host "2. Downloading DAML SDK $damlVersion..." -ForegroundColor Yellow
Write-Host "   URL: $downloadUrl" -ForegroundColor Gray

try {
    # Download with progress
    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "   ✅ Download complete" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Download failed: $_" -ForegroundColor Red
    Write-Host "   Please download manually from:" -ForegroundColor Yellow
    Write-Host "   https://github.com/digital-asset/daml/releases/tag/v$damlVersion" -ForegroundColor Cyan
    exit 1
}

Write-Host ""
Write-Host "3. Running installer..." -ForegroundColor Yellow
Write-Host "   File: $installerPath" -ForegroundColor Gray
Write-Host "   ⚠️  Please follow the installer prompts" -ForegroundColor Yellow
Write-Host ""

# Run installer
try {
    Start-Process -FilePath $installerPath -Wait
    Write-Host "   ✅ Installer completed" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Installation failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "4. Cleaning up..." -ForegroundColor Yellow
try {
    Remove-Item $installerPath -ErrorAction SilentlyContinue
    Write-Host "   ✅ Cleanup complete" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  Could not remove installer (may need manual cleanup)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "✅ Installation Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Close this terminal and open a NEW terminal" -ForegroundColor White
Write-Host "   2. Run: daml version" -ForegroundColor White
Write-Host "   3. Should display: $damlVersion" -ForegroundColor White
Write-Host ""
Write-Host "   If 'daml' command not found:" -ForegroundColor Yellow
Write-Host "   - Restart your terminal" -ForegroundColor White
Write-Host "   - Check PATH environment variable" -ForegroundColor White
Write-Host "   - Default location: C:\Users\$env:USERNAME\AppData\Local\daml\bin" -ForegroundColor Gray
Write-Host ""

