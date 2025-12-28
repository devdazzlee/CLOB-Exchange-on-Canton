# ⚡ INSTALL DAML SDK NOW - Simple Steps

## 🎯 What You Need to Do

### 1️⃣ Install Java First (If Not Installed)

**Download Java:**
- Go to: **https://adoptium.net/temurin/releases/**
- Select: **Windows x64** → **JDK 11** or **JDK 17**
- Download and install the `.msi` file
- ✅ Check "Add to PATH" during installation

**Verify Java:**
```bash
java -version
```

### 2️⃣ Download DAML SDK

**Click this link to download:**
👉 **https://github.com/digital-asset/daml/releases/download/v2.9.3/daml-sdk-2.9.3-windows.exe**

Or visit:
👉 **https://github.com/digital-asset/daml/releases/tag/v2.9.3**

Download: `daml-sdk-2.9.3-windows.exe`

### 3️⃣ Install DAML SDK

1. **Double-click** `daml-sdk-2.9.3-windows.exe`
2. Follow the installer:
   - Accept license
   - Use default installation path
   - ✅ **IMPORTANT**: Make sure "Add to PATH" is checked
3. Click "Install"
4. Wait for completion

### 4️⃣ Verify Installation

**⚠️ IMPORTANT: Close ALL terminals and open a NEW one!**

Then run:
```bash
daml version
```

Should show: `2.9.3`

### 5️⃣ Test Your Contracts

```bash
cd daml
daml build
```

Should create: `.daml/dist/clob-exchange-1.0.0.dar`

## 📍 Where It Installs

**Default Location:**
```
C:\Users\Lenovo\AppData\Local\daml\bin
```

This should be automatically added to your PATH.

## ❌ If "daml" Command Not Found

1. **Restart your terminal** (close all, open new)
2. **Check PATH manually:**
   - Press `Win + R`
   - Type: `sysdm.cpl` → Enter
   - Go to "Advanced" → "Environment Variables"
   - Under "System variables", find "Path"
   - Add: `C:\Users\Lenovo\AppData\Local\daml\bin`
   - Click OK
   - **Restart terminal again**

## ✅ Quick Test

After installation, run this:

```bash
daml version && echo "✅ DAML SDK installed!" || echo "❌ Installation failed"
```

## 🆘 Need Help?

- Check `INSTALL_DAML_SDK.md` for detailed guide
- Check `QUICK_INSTALL.md` for troubleshooting
- Run `install-daml.ps1` script (PowerShell as Admin)

---

**⏱️ Total Time: ~10 minutes**
**📦 Size: ~500 MB**
**🌐 Internet: Required**

