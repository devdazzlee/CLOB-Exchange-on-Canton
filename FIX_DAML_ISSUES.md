# Fixing DAML Build Issues

## Current Issues

1. **DAML SDK not in PATH** - Fixed by adding to PATH
2. **Multiple ensure statements** - DAML 2.9.3 requires single ensure block
3. **Map import issues** - Need qualified imports
4. **Case expression syntax** - Need proper indentation

## Quick Fix Commands

```bash
# Add DAML to PATH (add to ~/.zshrc for permanent fix)
export PATH="$HOME/.daml/bin:$PATH"

# Build DAML contracts
cd daml
daml build

# If build fails, check errors and fix syntax
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend should now work at http://localhost:3000

## Testing UI Functionality

1. **Wallet Creation**: Should work - creates wallet, shows seed phrase
2. **Order Placement**: May fail if OrderBook contracts don't exist on Canton
3. **Order Book**: Will be empty until OrderBook contracts are created
4. **Balance Display**: Will show 0.0 until UserAccount contracts are created

## Next Steps

1. Fix DAML syntax errors (ensure blocks, case expressions)
2. Build DAR file successfully  
3. Test frontend locally
4. Deploy to Canton devnet
5. Create initial OrderBook contracts



