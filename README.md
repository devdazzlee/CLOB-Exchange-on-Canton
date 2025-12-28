# CLOB Exchange - Milestone 1

A Central Limit Order Book (CLOB) exchange built on Canton blockchain using DAML smart contracts.

## Project Structure

```
.
├── daml/                    # DAML smart contracts
│   ├── UserAccount.daml    # User account with token balances
│   ├── Order.daml          # Individual buy/sell orders
│   ├── OrderBook.daml      # Order book management and matching
│   └── Trade.daml          # Executed trade records
├── wallet/                  # Wallet key management (standalone)
│   └── keyManager.js       # Key generation, mnemonic, encryption
├── frontend/                # React frontend application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/       # API integration
│   │   └── wallet/         # Frontend wallet utilities
│   └── package.json
└── daml.yaml               # DAML project configuration
```

## Prerequisites

- DAML SDK 2.9.3
- Node.js 18+ and npm
- Canton devnet access
- Your Canton Party ID: `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`

## Setup Instructions

### 1. Install Dependencies

#### DAML SDK
Download and install DAML SDK 2.9.3 from [DAML website](https://www.digitalasset.com/developers/downloads).

#### Frontend Dependencies
```bash
cd frontend
npm install
```

### 2. Build DAML Contracts

```bash
cd daml
daml build
```

This will create a `.daml/dist/clob-exchange-1.0.0.dar` file.

### 3. Deploy to Canton Devnet

```bash
daml ledger upload-dar \
  .daml/dist/clob-exchange-1.0.0.dar \
  --host participant.dev.canton.wolfedgelabs.com \
  --port 443 \
  --tls
```

**Note:** You may need to authenticate with your party credentials. Check the [Canton devnet documentation](https://docs.digitalasset.com/integrate/devnet/party-management/index.html) for authentication details.

### 4. Initialize Order Books

After deployment, you'll need to create OrderBook contracts for each trading pair. This is typically done by an operator party. You can use the Canton JSON API to create initial OrderBook contracts:

```bash
# Example: Create BTC/USDT order book
curl -X POST https://participant.dev.canton.wolfedgelabs.com/v1/create \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "OrderBook:OrderBook",
    "payload": {
      "tradingPair": "BTC/USDT",
      "buyOrders": [],
      "sellOrders": [],
      "operator": "YOUR_OPERATOR_PARTY_ID"
    },
    "actAs": ["YOUR_OPERATOR_PARTY_ID"]
  }'
```

### 5. Run Frontend

```bash
cd frontend
npm start
```

The application will be available at `http://localhost:3000`

## Usage

### 1. Wallet Setup

1. Navigate to the home page
2. Click "Create New Wallet" to generate a new wallet
3. **IMPORTANT:** Save the 12-word mnemonic phrase securely
4. Enter a password (minimum 8 characters) to encrypt your wallet
5. Your Party ID will be displayed once the wallet is created

### 2. Trading

1. Navigate to the Trading interface (`/trading`)
2. View your balance (initially 0.0 for all tokens)
3. Place orders:
   - Select trading pair (BTC/USDT or ETH/USDT)
   - Choose Buy or Sell
   - Choose Limit or Market order
   - Enter price (for limit orders) and quantity
   - Click "Place Order"
4. View the order book to see active buy/sell orders
5. View your active orders and cancel them if needed

### 3. Order Matching

- Limit orders match when buy price >= sell price
- Market orders match immediately with best available price
- Orders are automatically matched when added to the order book
- Successful matches create Trade records

## API Integration

The frontend uses the Canton JSON API to interact with the ledger:

- **Base URL:** `https://participant.dev.canton.wolfedgelabs.com/`
- **API Version:** `v1`

### Key Endpoints

- `POST /v1/create` - Create new contracts
- `POST /v1/exercise` - Exercise contract choices
- `POST /v1/query` - Query active contracts
- `GET /v1/parties/{party}` - Get party details

See `frontend/src/services/cantonApi.js` for implementation details.

## DAML Contracts Overview

### UserAccount
- Manages user token balances
- Choices: `Deposit`, `Withdraw`, `GetBalance`, `GetAllBalances`

### Order
- Represents individual buy/sell orders
- Fields: orderId, owner, orderType, orderMode, tradingPair, price, quantity, filled, status
- Choices: `CancelOrder`, `FillOrder`, `GetRemainingQuantity`

### OrderBook
- Manages order book for a trading pair
- Automatically matches compatible orders
- Choices: `AddOrder`, `MatchOrders`, `RemoveOrder`

### Trade
- Immutable record of executed trades
- Contains buyer, seller, price, quantity, timestamps

## Testing

### Manual Testing Flow

1. **Create Wallet**
   - Generate new wallet
   - Verify mnemonic is displayed
   - Confirm wallet creation

2. **Place Buy Order**
   - Select BTC/USDT pair
   - Choose Buy, Limit order
   - Enter price and quantity
   - Submit order
   - Verify order appears in "Your Active Orders"

3. **Place Sell Order**
   - Place a matching sell order (same or lower price)
   - Verify orders match automatically
   - Check Trade records are created

4. **Cancel Order**
   - Place an order
   - Cancel it using the Cancel button
   - Verify order status changes to CANCELLED

### Testing with Multiple Users

To test order matching, you'll need multiple party IDs. You can:
1. Create multiple wallets
2. Use different party IDs from the devnet
3. Place orders from different parties
4. Verify cross-party order matching

## Troubleshooting

### DAML Build Errors
- Ensure DAML SDK 2.9.3 is installed
- Check that all imports are correct
- Verify module names match file names

### Deployment Issues
- Verify Canton devnet connectivity
- Check party authentication
- Ensure TLS is enabled for HTTPS connections

### Frontend Errors
- Check browser console for errors
- Verify API endpoints are accessible
- Ensure wallet is properly initialized
- Check that OrderBook contracts exist for trading pairs

### Order Matching Not Working
- Verify OrderBook contract exists for the trading pair
- Check that orders have compatible prices
- Ensure operator party has proper permissions
- Verify contract choices are being exercised correctly

## Security Notes

- **Never share your mnemonic phrase** - it provides full access to your wallet
- **Use strong passwords** - minimum 8 characters recommended
- **Private keys are encrypted** - stored encrypted in localStorage
- **Validate all inputs** - both frontend and DAML contracts validate inputs
- **Authorization checks** - all contract choices verify proper authorization

## Next Steps (Future Milestones)

- [ ] Deposit/Withdraw functionality with actual token transfers
- [ ] Real-time order book updates
- [ ] Trade history display
- [ ] Advanced order types (stop-loss, take-profit)
- [ ] Multi-token support
- [ ] Order book depth visualization
- [ ] Price charts and analytics

## References

- [Canton JSON API Documentation](https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html)
- [Canton Quickstart](https://docs.digitalasset.com/build/3.4/quickstart/operate/explore-the-demo.html)
- [OTCTrade Example](https://github.com/hyperledger-labs/splice/blob/main/token-standard/examples/splice-token-test-trading-app/daml/Splice/Testing/Apps/TradingApp.daml)
- [Party Management](https://docs.digitalasset.com/integrate/devnet/party-management/index.html)

## License

This project is part of Milestone 1 development. All code is provided as-is for development purposes.

