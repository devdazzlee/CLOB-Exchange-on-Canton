# 🚀 Quick DAML SDK Installation Guide

## Step-by-Step Installation (Windows)

### Step 1: Install Java (Required)

**If Java is NOT installed:**

1. Download JDK 11 or later:
   - **Recommended**: https://adoptium.net/temurin/releases/
   - Choose: **Windows x64** → **JDK 11** or **JDK 17**
   - Download the `.msi` installer

2. Run the installer:
   - Check "Set JAVA_HOME variable"
   - Check "Add to PATH"
   - Complete installation

3. Verify Java:
   ```bash
   java -version
   ```
   Should show version 11 or higher.

### Step 2: Download DAML SDK

**Option A: Direct Download (Easiest)**

1. Open browser and go to:
   ```
   https://github.com/digital-asset/daml/releases/tag/v2.9.3
   ```

2. Download: `daml-sdk-2.9.3-windows.exe`
   - Direct link: https://github.com/digital-asset/daml/releases/download/v2.9.3/daml-sdk-2.9.3-windows.exe

**Option B: Use PowerShell Script**

1. Open PowerShell as Administrator:
   - Right-click Start → "Windows PowerShell (Admin)"

2. Navigate to project:
   ```powershell
   cd "C:\Users\Lenovo\Desktop\CLOB Exchange on Canton"
   ```

3. Run installer script:
   ```powershell
   .\install-daml.ps1
   ```

### Step 3: Run Installer

1. Double-click `daml-sdk-2.9.3-windows.exe`
2. Follow installation wizard:
   - Accept license
   - Choose installation directory (default is fine)
   - **Important**: Ensure "Add to PATH" is checked
3. Click "Install"
4. Wait for completion

### Step 4: Verify Installation

**IMPORTANT**: Close and reopen your terminal after installation!

1. Open a **NEW** terminal/command prompt
2. Test DAML:
   ```bash
   daml version
   ```
3. Should display: `2.9.3`

### Step 5: Test Your Contracts

```bash
cd "C:\Users\Lenovo\Desktop\CLOB Exchange on Canton\daml"
daml build
```

Should create: `.daml/dist/clob-exchange-1.0.0.dar`

## Troubleshooting

### "daml: command not found"

**Fix**:
1. Restart terminal (close all terminals, open new one)
2. Check PATH:
   ```bash
   echo %PATH%
   ```
3. If DAML not in PATH, add manually:
   - Default: `C:\Users\<YourUser>\AppData\Local\daml\bin`
   - Add to System Environment Variables → Path

### "Java not found"

**Fix**:
1. Install Java from https://adoptium.net/
2. Set JAVA_HOME environment variable
3. Restart terminal

### Installer won't run

**Fix**:
1. Right-click installer → "Run as Administrator"
2. Check Windows Defender isn't blocking it
3. Download again (file might be corrupted)

## Quick Commands Reference

```bash
# Check DAML version
daml version

# Build contracts
cd daml
daml build

# Deploy to Canton
daml ledger upload-dar .daml/dist/clob-exchange-1.0.0.dar \
  --host participant.dev.canton.wolfedgelabs.com \
  --port 443 --tls
```

## Installation Checklist

- [ ] Java JDK 11+ installed
- [ ] DAML SDK installer downloaded
- [ ] DAML SDK installed
- [ ] Terminal restarted
- [ ] `daml version` works
- [ ] `daml build` works

---

**Estimated Time**: 10-15 minutes
**Required**: Internet connection, Admin rights (for installer)

