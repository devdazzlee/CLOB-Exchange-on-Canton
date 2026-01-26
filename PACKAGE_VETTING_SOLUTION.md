# Canton Package Vetting Issue - Complete Solution Guide

## **Problem Summary**
The DAML package `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454` is uploaded to Canton but not vetted for participant `PAR::wolfedgelabs-dev-0::122087fa379c...`. This prevents OrderBook creation and order placement.

## **Error Message**
```
INVALID_PRESCRIBED_SYNCHRONIZER_ID: Participant PAR::wolfedgelabs-dev-0::122087fa379c... has not vetted f10023e35e41...
```

## **Root Cause**
Canton requires packages to be explicitly vetted by participants before they can be used in transactions. The package is uploaded but not vetted.

## **Current Status**
- ✅ Package uploaded to `participant.dev.canton.wolfedgelabs.com:443`
- ✅ Backend configured with correct participant ID
- ❌ Package not vetted for the participant
- ❌ VetDar API calls failing with "Invalid DAR main package-id" error

## **Solution Options**

### **Option 1: Canton Console (Recommended)**
Access the Canton console and run:
```bash
participant1.dars.vet("DAR_f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454")
```

### **Option 2: Wallet UI**
1. Go to https://wallet.validator.dev.canton.wolfedgelabs.com
2. Login with your token
3. Navigate to Package Management
4. Find the package and click "Vet Package"

### **Option 3: Manual gRPC Command**
```bash
grpcurl -insecure \
  -H "Authorization: Bearer YOUR_TOKEN" \
  participant.dev.canton.wolfedgelabs.com:443 \
  com.digitalasset.canton.admin.participant.v30.PackageService.VetDar \
  <<< '{"darId": "DAR_f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454"}'
```

### **Option 4: Use a Different Participant**
If you have access to a different participant that already has the package vetted, update the backend configuration:
```javascript
// backend/src/config/index.js
operatorPartyId: 'DIFFERENT_PARTY_ID_HERE'
```

### **Option 5: Re-upload with Vet All Packages**
Modify the upload script to include `vet_all_packages: true`:
```bash
grpcurl -insecure \
  -H "Authorization: Bearer TOKEN" \
  participant.dev.canton.wolfedgelabs.com:443 \
  com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar \
  <<< '{"dars": [{"bytes": "BASE64_DAR"}], "vet_all_packages": true}'
```

## **Verification Steps**
After vetting, run:
```bash
cd backend && node scripts/deploymentScript.js
```

Expected output:
```
✅ Deployment complete!
✅ OrderBook created for BTC/USDT
✅ OrderBook created for ETH/USDT
✅ OrderBook created for SOL/USDT
```

## **Technical Details**
- **Package ID**: `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454`
- **DAR ID**: `DAR_f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454`
- **Participant ID**: `wolfedgelabs-dev-0::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`
- **Synchronizer ID**: `global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a::34-0`

## **Troubleshooting**
If the VetDar API continues to fail:
1. Check if the participant has admin permissions
2. Verify the token is valid and not expired
3. Ensure the package ID format is correct
4. Try using the Canton console directly

## **Next Steps**
Once the package is vetted:
1. OrderBook creation should work
2. Order placement should work
3. The full CLOB Exchange functionality should be operational

## **Contact Support**
If you continue to face issues, contact the Canton support team with:
- Package ID: `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454`
- Participant ID: `wolfedgelabs-dev-0::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`
- Error message: `INVALID_PRESCRIBED_SYNCHRONIZER_ID`
