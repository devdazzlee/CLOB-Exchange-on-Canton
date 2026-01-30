# Backend Directory Structure

## Root Directory (Clean)
```
backend/
├── server.js              # Entry point only
├── package.json           # Dependencies
├── README.md              # Documentation
├── vercel.json            # Deployment config
├── .gitignore            # Git ignore rules
├── yarn.lock             # Lock file
└── src/                  # All source code
```

## Source Code Structure (`src/`)

```
src/
├── app.js                 # Express app setup
├── config/                # Configuration
│   └── index.js
├── controllers/           # Request handlers (MVC)
│   ├── adminController.js
│   ├── authController.js
│   ├── healthController.js
│   ├── orderBookController.js
│   ├── orderController.js
│   └── partyController.js
├── services/              # Business logic & external services
│   ├── canton-admin.js
│   ├── canton-api-helpers.js
│   ├── canton-grpc-client.js
│   ├── cantonService.js
│   ├── keycloak-mapper.js
│   ├── matchmaker.js
│   ├── matchmaker.ts
│   ├── order-service.js
│   ├── orderBookService.js
│   ├── party-service.js
│   ├── token-exchange.js
│   ├── utxo-handler.js
│   ├── utxo-merger.js
│   └── websocketService.js
├── routes/                # Route definitions
│   ├── index.js
│   ├── adminRoutes.js
│   ├── authRoutes.js
│   ├── healthRoutes.js
│   ├── ledgerRoutes.js
│   ├── orderBookRoutes.js
│   ├── orderRoutes.js
│   ├── partyRoutes.js
│   └── quotaRoutes.js
├── middleware/            # Express middleware
│   ├── asyncHandler.js
│   ├── errorHandler.js
│   └── validator.js
├── validators/            # Input validation
│   ├── adminValidators.js
│   ├── common.js
│   └── orderValidators.js
├── utils/                 # Utility functions
│   ├── errors.js
│   └── response.js
└── proto/                 # Protocol buffer definitions
    ├── party_management_service_v2.proto
    ├── user_management_service_v2.proto
    └── user_management_service.proto
```

## Organization Principles

1. **Root Directory**: Only essential files (entry point, config, docs)
2. **Services**: All business logic and external integrations
3. **Controllers**: HTTP request/response handling
4. **Routes**: API endpoint definitions
5. **Middleware**: Cross-cutting concerns
6. **Validators**: Input validation schemas
7. **Utils**: Shared utility functions
8. **Proto**: Protocol buffer definitions

## Benefits

- ✅ Clean root directory
- ✅ Logical file organization
- ✅ Easy to find and maintain code
- ✅ Follows professional best practices
- ✅ Scalable structure
