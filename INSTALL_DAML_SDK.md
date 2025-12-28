# Installing DAML SDK 2.9.3 on Windows

## Quick Installation Guide

### Option 1: Direct Download (Recommended for Windows)

1. **Download the DAML SDK Installer**:
   - Go to: https://github.com/digital-asset/daml/releases/tag/v2.9.3
   - Download: `daml-sdk-2.9.3-windows.exe`
   - Or direct link: https://github.com/digital-asset/daml/releases/download/v2.9.3/daml-sdk-2.9.3-windows.exe

2. **Run the Installer**:
   - Double-click the downloaded `.exe` file
   - Follow the installation wizard
   - The installer will add DAML to your PATH automatically

3. **Verify Installation**:
   - Open a **new** terminal/command prompt (important: restart terminal)
   - Run: `daml version`
   - Should display: `2.9.3`

### Option 2: Using PowerShell Script

Run this in PowerShell (as Administrator):

```powershell
# Download DAML SDK
$url = "https://github.com/digital-asset/daml/releases/download/v2.9.3/daml-sdk-2.9.3-windows.exe"
$output = "$env:TEMP\daml-sdk-installer.exe"
Invoke-WebRequest -Uri $url -OutFile $output

# Run installer
Start-Process -FilePath $output -Wait

# Clean up
Remove-Item $output
```

### Option 3: Manual Installation Steps

1. **Prerequisites**:
   - Java JDK 11 or later (check: `java -version`)
   - If not installed: Download from https://adoptium.net/

2. **Download**:
   - Visit: https://github.com/digital-asset/daml/releases/tag/v2.9.3
   - Download `daml-sdk-2.9.3-windows.exe`

3. **Install**:
   - Run the installer
   - Choose installation directory (default is fine)
   - Ensure "Add to PATH" is checked

4. **Restart Terminal**:
   - Close all terminal windows
   - Open a new terminal
   - Test: `daml version`

## After Installation

### Test DAML SDK

```bash
# Check version
daml version

# Should output: 2.9.3
```

### Build Your Contracts

```bash
cd daml
daml build
```

This will create: `.daml/dist/clob-exchange-1.0.0.dar`

### Deploy to Canton Devnet

```bash
daml ledger upload-dar \
  .daml/dist/clob-exchange-1.0.0.dar \
  --host participant.dev.canton.wolfedgelabs.com \
  --port 443 \
  --tls
```

## Troubleshooting

### Issue: "daml: command not found"

**Solution**:
1. Restart your terminal/command prompt
2. Check PATH: `echo $PATH` (Git Bash) or `echo %PATH%` (CMD)
3. Manually add DAML to PATH if needed:
   - Default location: `C:\Users\<YourUser>\AppData\Local\daml\bin`
   - Add to System Environment Variables → Path

### Issue: Java not found

**Solution**:
1. Install JDK 11+ from https://adoptium.net/
2. Set JAVA_HOME environment variable
3. Restart terminal

### Issue: Installation fails

**Solution**:
1. Run installer as Administrator
2. Check Windows Event Viewer for errors
3. Try downloading again (file might be corrupted)

## Verification Checklist

After installation, verify:

- [ ] `daml version` shows 2.9.3
- [ ] `daml build` works in `daml/` directory
- [ ] `.daml/dist/clob-exchange-1.0.0.dar` is created
- [ ] No error messages

## Next Steps

Once DAML SDK is installed:

1. **Build contracts**:
   ```bash
   cd daml
   daml build
   ```

2. **Test locally** (optional):
   ```bash
   daml start
   ```

3. **Deploy to Canton**:
   ```bash
   daml ledger upload-dar .daml/dist/clob-exchange-1.0.0.dar \
     --host participant.dev.canton.wolfedgelabs.com \
     --port 443 --tls
   ```

---

**Installation Time**: ~5-10 minutes
**Required Space**: ~500 MB
**Internet Required**: Yes (for download)

