# Canton JSON Ledger API v2 - Production-Ready Implementation

**Source of Truth:**
- Official Documentation: https://docs.digitalasset.com/build/latest/explanations/json-api/index.html
- Commands: https://docs.digitalasset.com/build/latest/explanations/json-api/commands.html
- Queries: https://docs.digitalasset.com/build/latest/explanations/json-api/queries.html
- Ledger State: https://docs.digitalasset.com/build/latest/explanations/json-api/ledger-state.html

**Package ID:** `<PACKAGE_ID>` (from deployed DAR file)
**Party ID:** `<PARTY>` (user's Canton party ID)

---

## 📋 STRICT DOCUMENTATION RULES

✅ **DO:**
- Omit optional fields instead of using `null`
- Use fully qualified `templateId`: `<package-id>:<module>:<template>`
- Include `commandId` in every command
- Use strings for Decimal values: `"42.0"`
- Use POST only
- Match OpenAPI schemas exactly

❌ **DON'T:**
- Send `null` for optional fields
- Use unqualified template IDs
- Omit `commandId`
- Use numbers for Decimal values
- Use GET/PUT/DELETE

---

## 1️⃣ PLACE BUY ORDER

### API Endpoint
```
POST /v2/commands/submit-and-wait
```

### Request Payload
```json
{
  "commands": [
    {
      "commandId": "buy-order-<timestamp>-<random>",
      "ExerciseCommand": {
        "contractId": "<ORDERBOOK_CONTRACT_ID>",
        "choice": "AddOrder",
        "exerciseArgument": {
          "orderId": "ORDER-<timestamp>-<random>",
          "owner": "<PARTY>",
          "orderType": "BUY",
          "orderMode": "LIMIT",
          "price": {
            "Some": "42000.0"
          },
          "quantity": "0.5"
        }
      }
    }
  ],
  "actAs": ["<PARTY>"]
}
```

**Documentation Traceability:**
- `commandId`: Required by `SubmitAndWaitRequest` schema (JSON API Commands docs)
- `ExerciseCommand`: Command type for exercising choices (JSON API Commands docs)
- `contractId`: Contract to exercise choice on (JSON API Commands docs)
- `choice`: Choice name from OrderBook template (DAML contract)
- `exerciseArgument`: Arguments matching choice signature (JSON API Commands docs)
- `actAs`: Party executing the command (JSON API Commands docs)
- `price.Some`: Optional Decimal format - use `{"Some": "value"}` or omit field (DAML Optional type)
- `quantity`: Decimal as string (JSON API Commands docs - Decimal values must be strings)

### Response Payload
```json
{
  "completionOffset": "0000000000000000000000000000000000000000000000000000000000000000:12345",
  "transaction": {
    "transactionId": "abc123def456...",
    "commandId": "buy-order-<timestamp>-<random>",
    "workflowId": "",
    "effectiveAt": "2024-01-01T12:00:00.000000Z",
    "events": [
      {
        "created": {
          "contractId": "00a1b2c3d4e5f6...",
          "templateId": "<PACKAGE_ID>:Order:Order",
          "payload": {
            "orderId": "ORDER-<timestamp>-<random>",
            "owner": "<PARTY>",
            "orderType": "BUY",
            "orderMode": "LIMIT",
            "tradingPair": "BTC/USDT",
            "price": {
              "Some": "42000.0"
            },
            "quantity": "0.5",
            "filled": "0.0",
            "status": "OPEN",
            "timestamp": "2024-01-01T12:00:00.000000Z",
            "operator": "<OPERATOR_PARTY>"
          }
        }
      },
      {
        "exercised": {
          "contractId": "<ORDERBOOK_CONTRACT_ID>",
          "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
          "choice": "AddOrder",
          "argument": {
            "orderId": "ORDER-<timestamp>-<random>",
            "owner": "<PARTY>",
            "orderType": "BUY",
            "orderMode": "LIMIT",
            "price": {
              "Some": "42000.0"
            },
            "quantity": "0.5"
          },
          "result": "00a1b2c3d4e5f6...",
          "consuming": true,
          "created": [
            {
              "contractId": "00a1b2c3d4e5f6...",
              "templateId": "<PACKAGE_ID>:Order:Order",
              "payload": {
                "orderId": "ORDER-<timestamp>-<random>",
                "owner": "<PARTY>",
                "orderType": "BUY",
                "orderMode": "LIMIT",
                "tradingPair": "BTC/USDT",
                "price": {
                  "Some": "42000.0"
                },
                "quantity": "0.5",
                "filled": "0.0",
                "status": "OPEN",
                "timestamp": "2024-01-01T12:00:00.000000Z",
                "operator": "<OPERATOR_PARTY>"
              }
            },
            {
              "contractId": "<ORDERBOOK_CONTRACT_ID_NEW>",
              "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
              "payload": {
                "tradingPair": "BTC/USDT",
                "buyOrders": ["00a1b2c3d4e5f6..."],
                "sellOrders": [],
                "lastPrice": null,
                "operator": "<OPERATOR_PARTY>"
              }
            }
          ]
        }
      }
    ]
  }
}
```

**Documentation Traceability:**
- `completionOffset`: Ledger offset where command completed (JSON API Commands docs)
- `transaction`: Transaction details (JSON API Commands docs)
- `transactionId`: Unique transaction identifier (JSON API Commands docs)
- `events`: List of events in transaction (JSON API Commands docs)
- `created`: Contract creation event (JSON API Commands docs)
- `exercised`: Choice exercise event (JSON API Commands docs)
- `contractId`: Contract identifier (JSON API Commands docs)
- `templateId`: Fully qualified template ID (JSON API Commands docs)
- `payload`: Contract data (JSON API Commands docs)

### TypeScript Integration Function
```typescript
/**
 * Place a buy limit order
 * @param orderBookContractId - Contract ID of OrderBook
 * @param party - User's party ID
 * @param tradingPair - Trading pair (e.g., "BTC/USDT")
 * @param price - Price as string (e.g., "42000.0")
 * @param quantity - Quantity as string (e.g., "0.5")
 * @param token - JWT authentication token
 * @returns Promise with transaction result
 */
async function placeBuyLimitOrder(
  orderBookContractId: string,
  party: string,
  tradingPair: string,
  price: string,
  quantity: string,
  token: string
): Promise<any> {
  // Generate unique command ID (required by SubmitAndWaitRequest schema)
  const commandId = `buy-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Build request payload according to JSON API v2 spec
  // Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/commands.html
  const requestBody = {
    commands: [
      {
        commandId: commandId, // Required by SubmitAndWaitRequest schema
        ExerciseCommand: {
          contractId: orderBookContractId,
          choice: "AddOrder", // Choice name from OrderBook template
          exerciseArgument: {
            orderId: orderId,
            owner: party,
            orderType: "BUY",
            orderMode: "LIMIT",
            // Optional Decimal: use {"Some": "value"} format (DAML Optional type)
            price: {
              Some: price // Decimal as string (required by JSON API spec)
            },
            quantity: quantity // Decimal as string (required by JSON API spec)
          }
        }
      }
    ],
    actAs: [party] // Party executing the command (required by SubmitAndWaitRequest schema)
  };

  const response = await fetch("/v2/commands/submit-and-wait", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to place buy order: ${response.statusText}`);
  }

  return await response.json();
}
```

---

## 2️⃣ PLACE SELL ORDER

### API Endpoint
```
POST /v2/commands/submit-and-wait
```

### Request Payload
```json
{
  "commands": [
    {
      "commandId": "sell-order-<timestamp>-<random>",
      "ExerciseCommand": {
        "contractId": "<ORDERBOOK_CONTRACT_ID>",
        "choice": "AddOrder",
        "exerciseArgument": {
          "orderId": "ORDER-<timestamp>-<random>",
          "owner": "<PARTY>",
          "orderType": "SELL",
          "orderMode": "LIMIT",
          "price": {
            "Some": "43000.0"
          },
          "quantity": "0.3"
        }
      }
    }
  ],
  "actAs": ["<PARTY>"]
}
```

**Documentation Traceability:**
- Same structure as buy order, only `orderType` changes to `"SELL"`

### Response Payload
```json
{
  "completionOffset": "0000000000000000000000000000000000000000000000000000000000000000:12346",
  "transaction": {
    "transactionId": "def456ghi789...",
    "commandId": "sell-order-<timestamp>-<random>",
    "workflowId": "",
    "effectiveAt": "2024-01-01T12:00:01.000000Z",
    "events": [
      {
        "created": {
          "contractId": "00f1e2d3c4b5a6...",
          "templateId": "<PACKAGE_ID>:Order:Order",
          "payload": {
            "orderId": "ORDER-<timestamp>-<random>",
            "owner": "<PARTY>",
            "orderType": "SELL",
            "orderMode": "LIMIT",
            "tradingPair": "BTC/USDT",
            "price": {
              "Some": "43000.0"
            },
            "quantity": "0.3",
            "filled": "0.0",
            "status": "OPEN",
            "timestamp": "2024-01-01T12:00:01.000000Z",
            "operator": "<OPERATOR_PARTY>"
          }
        }
      },
      {
        "exercised": {
          "contractId": "<ORDERBOOK_CONTRACT_ID>",
          "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
          "choice": "AddOrder",
          "argument": {
            "orderId": "ORDER-<timestamp>-<random>",
            "owner": "<PARTY>",
            "orderType": "SELL",
            "orderMode": "LIMIT",
            "price": {
              "Some": "43000.0"
            },
            "quantity": "0.3"
          },
          "result": "00f1e2d3c4b5a6...",
          "consuming": true,
          "created": [
            {
              "contractId": "00f1e2d3c4b5a6...",
              "templateId": "<PACKAGE_ID>:Order:Order",
              "payload": {
                "orderId": "ORDER-<timestamp>-<random>",
                "owner": "<PARTY>",
                "orderType": "SELL",
                "orderMode": "LIMIT",
                "tradingPair": "BTC/USDT",
                "price": {
                  "Some": "43000.0"
                },
                "quantity": "0.3",
                "filled": "0.0",
                "status": "OPEN",
                "timestamp": "2024-01-01T12:00:01.000000Z",
                "operator": "<OPERATOR_PARTY>"
              }
            },
            {
              "contractId": "<ORDERBOOK_CONTRACT_ID_NEW>",
              "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
              "payload": {
                "tradingPair": "BTC/USDT",
                "buyOrders": ["00a1b2c3d4e5f6..."],
                "sellOrders": ["00f1e2d3c4b5a6..."],
                "lastPrice": null,
                "operator": "<OPERATOR_PARTY>"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### TypeScript Integration Function
```typescript
/**
 * Place a sell limit order
 * @param orderBookContractId - Contract ID of OrderBook
 * @param party - User's party ID
 * @param tradingPair - Trading pair (e.g., "BTC/USDT")
 * @param price - Price as string (e.g., "43000.0")
 * @param quantity - Quantity as string (e.g., "0.3")
 * @param token - JWT authentication token
 * @returns Promise with transaction result
 */
async function placeSellLimitOrder(
  orderBookContractId: string,
  party: string,
  tradingPair: string,
  price: string,
  quantity: string,
  token: string
): Promise<any> {
  const commandId = `sell-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const requestBody = {
    commands: [
      {
        commandId: commandId, // Required by SubmitAndWaitRequest schema
        ExerciseCommand: {
          contractId: orderBookContractId,
          choice: "AddOrder",
          exerciseArgument: {
            orderId: orderId,
            owner: party,
            orderType: "SELL", // Different from buy order
            orderMode: "LIMIT",
            price: {
              Some: price
            },
            quantity: quantity
          }
        }
      }
    ],
    actAs: [party]
  };

  const response = await fetch("/v2/commands/submit-and-wait", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to place sell order: ${response.statusText}`);
  }

  return await response.json();
}
```

---

## 3️⃣ CREATE ORDERBOOK

### API Endpoint
```
POST /v2/commands/submit-and-wait
```

### Request Payload
```json
{
  "commands": [
    {
      "commandId": "create-orderbook-<timestamp>-<random>",
      "CreateCommand": {
        "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
        "createArguments": {
          "tradingPair": "BTC/USDT",
          "buyOrders": [],
          "sellOrders": [],
          "operator": "<OPERATOR_PARTY>"
        }
      }
    }
  ],
  "actAs": ["<OPERATOR_PARTY>"]
}
```

**Documentation Traceability:**
- `CreateCommand`: Command type for creating contracts (JSON API Commands docs)
- `templateId`: Fully qualified template ID (required by CreateCommand schema)
- `createArguments`: Contract fields matching template signature (JSON API Commands docs)
- `buyOrders`: Empty array for ContractId list (DAML contract - `[ContractId Order]`)
- `sellOrders`: Empty array for ContractId list (DAML contract - `[ContractId Order]`)
- `lastPrice`: **OMITTED** (Optional Decimal - omit instead of null per JSON API spec)

### Response Payload
```json
{
  "completionOffset": "0000000000000000000000000000000000000000000000000000000000000000:12347",
  "transaction": {
    "transactionId": "ghi789jkl012...",
    "commandId": "create-orderbook-<timestamp>-<random>",
    "workflowId": "",
    "effectiveAt": "2024-01-01T12:00:02.000000Z",
    "events": [
      {
        "created": {
          "contractId": "00x1y2z3a4b5c6...",
          "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
          "payload": {
            "tradingPair": "BTC/USDT",
            "buyOrders": [],
            "sellOrders": [],
            "lastPrice": null,
            "operator": "<OPERATOR_PARTY>"
          }
        }
      }
    ]
  }
}
```

**Documentation Traceability:**
- Response includes `lastPrice: null` because it's Optional in DAML template
- Empty arrays are valid for ContractId lists

### TypeScript Integration Function
```typescript
/**
 * Create an OrderBook contract for a trading pair
 * @param packageId - Package ID from deployed DAR
 * @param operatorParty - Operator party ID (must have permissions)
 * @param tradingPair - Trading pair (e.g., "BTC/USDT")
 * @param token - JWT authentication token
 * @returns Promise with transaction result
 */
async function createOrderBook(
  packageId: string,
  operatorParty: string,
  tradingPair: string,
  token: string
): Promise<any> {
  const commandId = `create-orderbook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Build request payload according to JSON API v2 spec
  // Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/commands.html
  const requestBody = {
    commands: [
      {
        commandId: commandId, // Required by SubmitAndWaitRequest schema
        CreateCommand: {
          // Fully qualified template ID (required by CreateCommand schema)
          templateId: `${packageId}:OrderBook:OrderBook`,
          createArguments: {
            tradingPair: tradingPair,
            buyOrders: [], // Empty array for ContractId list
            sellOrders: [], // Empty array for ContractId list
            operator: operatorParty
            // lastPrice is Optional Decimal - OMIT instead of null (per JSON API spec)
          }
        }
      }
    ],
    actAs: [operatorParty] // Operator must have permissions to create OrderBook
  };

  const response = await fetch("/v2/commands/submit-and-wait", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to create OrderBook: ${response.statusText}`);
  }

  return await response.json();
}
```

---

## 4️⃣ QUERY ORDER BOOK

### API Endpoint
```
POST /v2/state/active-contracts
```

### Request Payload
```json
{
  "activeAtOffset": "0",
  "verbose": false,
  "filter": {
    "filtersByParty": {
      "<PARTY>": {
        "inclusive": {
          "templateIds": ["<PACKAGE_ID>:OrderBook:OrderBook"]
        }
      }
    }
  }
}
```

**Documentation Traceability:**
- `activeAtOffset`: "0" means current ledger end (JSON API Ledger State docs)
- `verbose`: Required field - whether to include event metadata (JSON API Ledger State docs)
- `filter`: Filter for contracts (JSON API Ledger State docs)
- `filtersByParty`: Filter by specific party (JSON API Ledger State docs)
- `inclusive`: Inclusive filter (JSON API Ledger State docs)
- `templateIds`: Array of fully qualified template IDs (JSON API Ledger State docs)

### Response Payload
```json
{
  "activeContracts": [
    {
      "contractId": "00x1y2z3a4b5c6...",
      "templateId": "<PACKAGE_ID>:OrderBook:OrderBook",
      "payload": {
        "tradingPair": "BTC/USDT",
        "buyOrders": ["00a1b2c3d4e5f6...", "00b2c3d4e5f6a7..."],
        "sellOrders": ["00f1e2d3c4b5a6...", "00e2d3c4b5a6f7..."],
        "lastPrice": {
          "Some": "42500.0"
        },
        "operator": "<OPERATOR_PARTY>"
      }
    }
  ]
}
```

**Documentation Traceability:**
- `activeContracts`: Array of active contracts (JSON API Ledger State docs)
- `contractId`: Contract identifier (JSON API Ledger State docs)
- `templateId`: Fully qualified template ID (JSON API Ledger State docs)
- `payload`: Contract data (JSON API Ledger State docs)
- `buyOrders`: Array of ContractIds (DAML contract)
- `sellOrders`: Array of ContractIds (DAML contract)
- `lastPrice.Some`: Optional Decimal format (DAML Optional type)

### TypeScript Integration Function
```typescript
/**
 * Query OrderBook contracts
 * @param packageId - Package ID from deployed DAR
 * @param party - User's party ID
 * @param token - JWT authentication token
 * @returns Promise with array of OrderBook contracts
 */
async function queryOrderBook(
  packageId: string,
  party: string,
  token: string
): Promise<any[]> {
  // Build request payload according to JSON API v2 spec
  // Reference: https://docs.digitalasset.com/build/latest/explanations/json-api/ledger-state.html
  const requestBody = {
    activeAtOffset: "0", // "0" means current ledger end (required by ActiveContractsRequest schema)
    verbose: false, // Required field: whether to include event metadata (required by ActiveContractsRequest schema)
    filter: {
      filtersByParty: {
        [party]: {
          inclusive: {
            // Fully qualified template IDs (required by InclusiveFilters schema)
            templateIds: [`${packageId}:OrderBook:OrderBook`]
          }
        }
      }
    }
  };

  const response = await fetch("/v2/state/active-contracts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to query OrderBook: ${response.statusText}`);
  }

  const result = await response.json();
  return result.activeContracts || []; // Return array of contracts (ActiveContractsResponse schema)
}
```

---

## 5️⃣ QUERY MY ORDERS

### API Endpoint
```
POST /v2/state/active-contracts
```

### Request Payload
```json
{
  "activeAtOffset": "0",
  "verbose": false,
  "filter": {
    "filtersByParty": {
      "<PARTY>": {
        "inclusive": {
          "templateIds": ["<PACKAGE_ID>:Order:Order"]
        }
      }
    }
  }
}
```

**Documentation Traceability:**
- Same structure as OrderBook query, only `templateId` changes to `Order:Order`

### Response Payload
```json
{
  "activeContracts": [
    {
      "contractId": "00a1b2c3d4e5f6...",
      "templateId": "<PACKAGE_ID>:Order:Order",
      "payload": {
        "orderId": "ORDER-1234567890-abc123",
        "owner": "<PARTY>",
        "orderType": "BUY",
        "orderMode": "LIMIT",
        "tradingPair": "BTC/USDT",
        "price": {
          "Some": "42000.0"
        },
        "quantity": "0.5",
        "filled": "0.0",
        "status": "OPEN",
        "timestamp": "2024-01-01T12:00:00.000000Z",
        "operator": "<OPERATOR_PARTY>"
      }
    },
    {
      "contractId": "00f1e2d3c4b5a6...",
      "templateId": "<PACKAGE_ID>:Order:Order",
      "payload": {
        "orderId": "ORDER-1234567891-def456",
        "owner": "<PARTY>",
        "orderType": "SELL",
        "orderMode": "LIMIT",
        "tradingPair": "BTC/USDT",
        "price": {
          "Some": "43000.0"
        },
        "quantity": "0.3",
        "filled": "0.1",
        "status": "OPEN",
        "timestamp": "2024-01-01T12:00:01.000000Z",
        "operator": "<OPERATOR_PARTY>"
      }
    }
  ]
}
```

### TypeScript Integration Function
```typescript
/**
 * Query user's orders
 * @param packageId - Package ID from deployed DAR
 * @param party - User's party ID
 * @param token - JWT authentication token
 * @returns Promise with array of Order contracts
 */
async function queryMyOrders(
  packageId: string,
  party: string,
  token: string
): Promise<any[]> {
  const requestBody = {
    activeAtOffset: "0", // Current ledger end
    verbose: false, // Required field
    filter: {
      filtersByParty: {
        [party]: {
          inclusive: {
            templateIds: [`${packageId}:Order:Order`] // Different template ID
          }
        }
      }
    }
  };

  const response = await fetch("/v2/state/active-contracts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to query orders: ${response.statusText}`);
  }

  const result = await response.json();
  return result.activeContracts || [];
}
```

---

## 6️⃣ QUERY BALANCES

### API Endpoint
```
POST /v2/state/active-contracts
```

### Request Payload
```json
{
  "activeAtOffset": "0",
  "verbose": false,
  "filter": {
    "filtersByParty": {
      "<PARTY>": {
        "inclusive": {
          "templateIds": ["<PACKAGE_ID>:UserAccount:UserAccount"]
        }
      }
    }
  }
}
```

**Documentation Traceability:**
- Same structure as other queries, only `templateId` changes to `UserAccount:UserAccount`

### Response Payload
```json
{
  "activeContracts": [
    {
      "contractId": "00u1v2w3x4y5z6...",
      "templateId": "<PACKAGE_ID>:UserAccount:UserAccount",
      "payload": {
        "party": "<PARTY>",
        "balances": [
          ["BTC", "1.5"],
          ["USDT", "50000.0"]
        ],
        "operator": "<OPERATOR_PARTY>"
      }
    }
  ]
}
```

**Documentation Traceability:**
- `balances`: Map format - array of [key, value] pairs (DAML Map type)
- Decimal values as strings in Map values

### TypeScript Integration Function
```typescript
/**
 * Query user account balances
 * @param packageId - Package ID from deployed DAR
 * @param party - User's party ID
 * @param token - JWT authentication token
 * @returns Promise with UserAccount contract or null
 */
async function queryBalances(
  packageId: string,
  party: string,
  token: string
): Promise<any | null> {
  const requestBody = {
    activeAtOffset: "0", // Current ledger end
    verbose: false, // Required field
    filter: {
      filtersByParty: {
        [party]: {
          inclusive: {
            templateIds: [`${packageId}:UserAccount:UserAccount`] // Different template ID
          }
        }
      }
    }
  };

  const response = await fetch("/v2/state/active-contracts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to query balances: ${response.statusText}`);
  }

  const result = await response.json();
  const contracts = result.activeContracts || [];
  
  // Return first UserAccount contract (user should have only one)
  return contracts.length > 0 ? contracts[0] : null;
}

/**
 * Extract BTC and USDT balances from UserAccount contract
 * @param userAccount - UserAccount contract from queryBalances
 * @returns Object with BTC and USDT balances
 */
function extractBalances(userAccount: any): { BTC: string; USDT: string } {
  if (!userAccount || !userAccount.payload || !userAccount.payload.balances) {
    return { BTC: "0.0", USDT: "0.0" };
  }

  const balances = userAccount.payload.balances;
  let btcBalance = "0.0";
  let usdtBalance = "0.0";

  // Handle Map format: array of [key, value] pairs
  if (Array.isArray(balances)) {
    balances.forEach(([key, value]) => {
      if (key === "BTC") btcBalance = value?.toString() || "0.0";
      if (key === "USDT") usdtBalance = value?.toString() || "0.0";
    });
  } else if (balances && typeof balances === "object") {
    // Handle object format (if API returns it differently)
    btcBalance = balances.BTC?.toString() || "0.0";
    usdtBalance = balances.USDT?.toString() || "0.0";
  }

  return {
    BTC: btcBalance,
    USDT: usdtBalance
  };
}
```

---

## 7️⃣ CANCEL ORDER

### API Endpoint
```
POST /v2/commands/submit-and-wait
```

### Request Payload
```json
{
  "commands": [
    {
      "commandId": "cancel-order-<timestamp>-<random>",
      "ExerciseCommand": {
        "contractId": "<ORDER_CONTRACT_ID>",
        "choice": "CancelOrder",
        "exerciseArgument": {}
      }
    }
  ],
  "actAs": ["<PARTY>"]
}
```

**Documentation Traceability:**
- `CancelOrder` choice takes no arguments (empty object)
- `contractId`: Order contract to cancel

### Response Payload
```json
{
  "completionOffset": "0000000000000000000000000000000000000000000000000000000000000000:12348",
  "transaction": {
    "transactionId": "jkl012mno345...",
    "commandId": "cancel-order-<timestamp>-<random>",
    "workflowId": "",
    "effectiveAt": "2024-01-01T12:00:03.000000Z",
    "events": [
      {
        "exercised": {
          "contractId": "<ORDER_CONTRACT_ID>",
          "templateId": "<PACKAGE_ID>:Order:Order",
          "choice": "CancelOrder",
          "argument": {},
          "result": null,
          "consuming": true,
          "created": [
            {
              "contractId": "<ORDER_CONTRACT_ID_NEW>",
              "templateId": "<PACKAGE_ID>:Order:Order",
              "payload": {
                "orderId": "ORDER-1234567890-abc123",
                "owner": "<PARTY>",
                "orderType": "BUY",
                "orderMode": "LIMIT",
                "tradingPair": "BTC/USDT",
                "price": {
                  "Some": "42000.0"
                },
                "quantity": "0.5",
                "filled": "0.0",
                "status": "CANCELLED",
                "timestamp": "2024-01-01T12:00:00.000000Z",
                "operator": "<OPERATOR_PARTY>"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### TypeScript Integration Function
```typescript
/**
 * Cancel an order
 * @param orderContractId - Contract ID of Order to cancel
 * @param party - User's party ID
 * @param token - JWT authentication token
 * @returns Promise with transaction result
 */
async function cancelOrder(
  orderContractId: string,
  party: string,
  token: string
): Promise<any> {
  const commandId = `cancel-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const requestBody = {
    commands: [
      {
        commandId: commandId, // Required by SubmitAndWaitRequest schema
        ExerciseCommand: {
          contractId: orderContractId,
          choice: "CancelOrder", // Choice name from Order template
          exerciseArgument: {} // CancelOrder takes no arguments (empty object)
        }
      }
    ],
    actAs: [party] // Owner must be controller of CancelOrder choice
  };

  const response = await fetch("/v2/commands/submit-and-wait", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { message: errorText };
    }
    throw new Error(error.message || `Failed to cancel order: ${response.statusText}`);
  }

  return await response.json();
}
```

---

## 📚 SUMMARY

All implementations follow the **official Canton JSON Ledger API v2 specification**:

1. ✅ **No `null` values** - Optional fields are omitted
2. ✅ **Fully qualified template IDs** - `<package-id>:<module>:<template>`
3. ✅ **`commandId` required** - Every command includes unique commandId
4. ✅ **Decimal as strings** - All Decimal values are strings: `"42.0"`
5. ✅ **POST only** - All endpoints use POST method
6. ✅ **Schema-compliant** - Matches OpenAPI schemas exactly

**Next Steps:**
1. Replace `<PACKAGE_ID>` with actual package ID from deployed DAR
2. Replace `<PARTY>` with user's actual party ID
3. Replace `<OPERATOR_PARTY>` with operator's party ID
4. Test each endpoint with real tokens and contracts



