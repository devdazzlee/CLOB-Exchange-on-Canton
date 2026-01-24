# Splice API Adjustments Required

## ⚠️ Important Notes

The DAML code in `MasterOrderBook.daml` and `Order.daml` uses placeholder calls to the Splice Allocation API. **You must adjust these based on your actual Splice installation and API version.**

## Areas Requiring Adjustment

### 1. Allocation API Choice Names

**Current code uses:**
```daml
Api.Token.AllocationV1.Allocation_ExecuteTransfer
Api.Token.AllocationV1.Allocation_Cancel
```

**May need to be:**
- `Allocation_ExecuteTransfer` (without module prefix)
- `Allocation_Cancel` (without module prefix)
- Or different names entirely based on your Splice version

### 2. Allocation_ExecuteTransfer ExtraArgs

**Current code:**
```daml
exercise allocationCid Api.Token.AllocationV1.Allocation_ExecuteTransfer with
  extraArgs = ()  -- ⚠️ ADJUST THIS
```

**May need:**
```daml
exercise allocationCid Allocation_ExecuteTransfer with
  extraArgs = ExtraArgs with
    -- Add actual fields based on Splice API
    settlementRef = ...
    -- etc.
```

**Reference from TradingApp.daml:**
```daml
exercise allocCid (Allocation_ExecuteTransfer extraArgs)
```

### 3. Allocation View/Structure

**Current code:**
```daml
let allocationView = view @Api.Token.AllocationV1.Allocation allocation
```

**May need to adjust:**
- The view structure may be different
- Field names may vary
- Validation logic needs to check actual Allocation fields

### 4. Token_Lock Choice

**Frontend needs to call:**
```typescript
Token:Token_Lock
```

**But actual choice may be:**
- `Token_Lock`
- `Token_CreateAllocation`
- `Token_LockForSettlement`
- Or different name based on Splice version

## How to Find the Correct API

1. **Check your Splice package documentation**
2. **Inspect the `TradingApp.daml` imports:**
   ```daml
   import Splice.Api.Token.AllocationV1 as Api.Token.AllocationV1
   ```
3. **Look at actual choice signatures in your Splice packages**
4. **Check Splice SDK/examples for correct usage**

## Testing Strategy

1. **Start with a simple test:**
   - Create a single Allocation manually
   - Try to execute it
   - Adjust API calls based on errors

2. **Incremental approach:**
   - First: Get Allocation creation working
   - Second: Get Allocation execution working
   - Third: Integrate with Order placement
   - Fourth: Integrate with Order matching

## Common Issues

### Issue: "Choice not found"
- **Solution:** Check exact choice name in Splice package
- May need to use qualified name or different module path

### Issue: "Wrong number of arguments"
- **Solution:** Check `ExtraArgs` structure
- May need to provide settlement info, metadata, etc.

### Issue: "Allocation not executable"
- **Solution:** Verify Allocation was created with correct provider
- Check that Operator party has execution rights

## Recommended Next Steps

1. **Build the DAML code** - This will show import errors if package names are wrong
2. **Adjust package names in `daml.yaml`** based on build errors
3. **Test Allocation creation** in isolation
4. **Test Allocation execution** in isolation
5. **Integrate with Order flow** once Allocations work

## Getting Help

- Check Splice documentation
- Review `TradingApp.daml` for exact API usage patterns
- Consult Splice support/community
- Check Splice SDK examples
