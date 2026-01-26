# Manual Package Vetting Instructions

## Problem
The DAML package `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454` is uploaded but not vetted for participant `PAR::wolfedgelabs-dev-0::122087fa379c...`.

## Solution Options

### Option 1: Canton Console (Recommended)
1. Open Canton console
2. Run the following command:
   ```
   participant1.dars.vet("DAR_f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454")
   ```

### Option 2: Wallet UI
1. Go to https://wallet.validator.dev.canton.wolfedgelabs.com
2. Login with your token
3. Navigate to Package Management
4. Find the package `f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454`
5. Click "Vet Package"

### Option 3: Use gRPC directly
```bash
grpcurl -insecure \
  -H "Authorization: Bearer YOUR_TOKEN" \
  participant.dev.canton.wolfedgelabs.com:443 \
  com.digitalasset.canton.admin.participant.v30.PackageService.VetDar \
  <<< '{"darId": "DAR_f10023e35e41e6c76e2863bca154fbec275d01fdf528012dc3954e5f4a769454", "synchronizeVetting": false}'
```

## Verification
After vetting, run:
```bash
cd backend && node scripts/deploymentScript.js
```

The OrderBook creation should work without the `INVALID_PRESCRIBED_SYNCHRONIZER_ID` error.
