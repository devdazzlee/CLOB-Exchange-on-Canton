# Client Response - CBTC Integration Status

## ✅ What's Done

1. **Splice Token Standard Integration**: System now queries `splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding` template
2. **Template Discovery**: Implemented automatic discovery of Splice Holding template ID
3. **Balance Query**: Backend queries both Splice Holdings (CBTC) and custom Holdings (test tokens)
4. **CBTC Faucet Integration**: Ready to accept CBTC transfers from faucet

## 🔧 What Needs To Be Done

1. **Get CBTC from Faucet**: Request CBTC tokens from https://cbtc-faucet.bitsafe.finance/
2. **Accept Transfer Offer**: Accept the CBTC transfer offer in Utilities UI (Registry → Transfers)
3. **Verify Balance**: Once accepted, CBTC balance will appear automatically in the system

## 📋 Technical Details

- **Template ID**: `splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding`
- **Status**: System is configured to query this template for CBTC Holdings
- **Next Step**: After accepting CBTC transfer offer, balance will show automatically

## ⚠️ Important Notes

- Please don't abuse the faucet with frequent requests
- System will automatically detect CBTC Holdings once transfer is accepted
- No custom instruments needed - using actual Splice Token Standard

---

**Status**: Ready for CBTC integration. Just need to accept the transfer offer from faucet.
