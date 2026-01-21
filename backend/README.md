# CLOB Exchange Backend

Professional backend architecture with MVC pattern, following senior developer best practices.

## Architecture

```
backend/
├── src/
│   ├── config/          # Configuration management
│   ├── controllers/     # Request handlers (MVC)
│   ├── services/        # Business logic layer
│   ├── routes/          # Route definitions
│   ├── middleware/      # Express middleware
│   ├── validators/      # Input validation schemas
│   ├── utils/           # Utility functions
│   └── app.js           # Express app setup
├── server.js            # Entry point
└── [existing services]  # Legacy services (token-exchange, party-service, etc.)
```

## Features

- **MVC Architecture**: Clear separation of concerns
- **Service Layer**: Business logic separated from controllers
- **Input Validation**: Joi-based validation middleware
- **Error Handling**: Centralized error handling with custom error classes
- **WebSocket Support**: Real-time updates via WebSocket service
- **Type Safety**: Consistent response formats
- **Configuration Management**: Centralized config with environment variables

## API Endpoints

### OrderBooks
- `GET /api/orderbooks` - Get all OrderBooks
- `GET /api/orderbooks/:tradingPair` - Get OrderBook by trading pair
- `GET /api/orderbooks/:tradingPair/orders` - Get orders for trading pair

### Orders
- `POST /api/orders/place` - Place an order
- `POST /api/orders/cancel` - Cancel an order

### Admin
- `POST /api/admin/orderbooks/:tradingPair` - Create OrderBook
- `POST /api/admin/upload-dar` - Upload DAR file

### Party Management
- `POST /api/create-party` - Create a party
- `GET /api/quota-status` - Get quota status

### Authentication
- `POST /api/token-exchange` - Exchange Keycloak token
- `POST /api/inspect-token` - Inspect token

### Health
- `GET /health` - Health check
- `GET /api/ws/status` - WebSocket status

### Ledger Proxy
- `ALL /api/ledger/*` - Proxy to Canton Ledger API

## Running the Server

```bash
npm install
npm start
```

## Development

The backend follows professional best practices:
- Controllers handle HTTP requests/responses
- Services contain business logic
- Routes define API endpoints
- Middleware handles cross-cutting concerns
- Validators ensure data integrity
- Error handling is centralized and consistent
