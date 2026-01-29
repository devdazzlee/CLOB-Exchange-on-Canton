---
description: How to implement Canton/DAML integration for the CLOB Exchange without patches or fallbacks
---

# Canton Integration Workflow

This workflow describes how to implement proper Canton/DAML integration following the "no patch" architecture.

## Prerequisites

1. Canton participant node running with PostgreSQL (not in-memory)
2. DAR file uploaded and vetted on all participants
3. Environment variables configured (see `.env.example`)

## Step 1: Validate Configuration

```bash
cd backend
node -e "require('./src/config/validation').validate()"
```

If validation fails, fix missing environment variables before proceeding.

## Step 2: Test Canton Connection

// turbo
```bash
curl -s "${CANTON_JSON_API_BASE}/v2/version" -H "Authorization: Bearer ${TOKEN}" | jq
```

Expected: JSON response with Canton version info.

## Step 3: Verify Package Deployment

// turbo
```bash
curl -s "${CANTON_JSON_API_BASE}/v2/packages" -H "Authorization: Bearer ${TOKEN}" | jq '.packageIds'
```

Verify your CLOB_EXCHANGE_PACKAGE_ID is in the list.

## Step 4: Start Backend with Read Model

```bash
cd backend
npm run start
```

Watch logs for:
- "✅ Configuration validation passed"
- "✅ Canton connection verified"
- "[ReadModel] ✅ Initialization complete"

## Step 5: Test Order Placement

// turbo
```bash
curl -X POST http://localhost:3001/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user" \
  -H "x-party-id: ${USER_PARTY_ID}" \
  -d '{
    "pair": "BTC/USDT",
    "side": "BUY",
    "type": "LIMIT",
    "price": "42000.00",
    "quantity": "0.10"
  }' | jq
```

Expected response:
```json
{
  "ok": true,
  "data": {
    "orderId": "O-...",
    "ledgerContractId": "00...",
    "status": "OPEN"
  }
}
```

## Step 6: Verify Order on Ledger

// turbo
```bash
curl -X POST "${CANTON_JSON_API_BASE}/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "filter": {
      "filtersByParty": {
        "'${OPERATOR_PARTY_ID}'": {
          "inclusive": {
            "templateIds": ["'${CLOB_EXCHANGE_PACKAGE_ID}':Order:Order"]
          }
        }
      }
    },
    "verbose": true
  }' | jq '.activeContracts | length'
```

Expected: Number greater than 0 (your order exists on ledger).

## Step 7: Test Order Cancellation

```bash
curl -X DELETE http://localhost:3001/api/v1/orders/${ORDER_ID} \
  -H "x-user-id: test-user" \
  -H "x-party-id: ${USER_PARTY_ID}" | jq
```

Expected:
```json
{
  "ok": true,
  "data": {
    "orderId": "...",
    "status": "CANCELLED"
  }
}
```

## Verification Checklist

- [ ] Configuration validation passes
- [ ] Canton connection verified
- [ ] Package ID discovered/configured
- [ ] Read model initializes from ACS
- [ ] WebSocket streaming connects
- [ ] Orders create contracts on ledger
- [ ] Orders appear in read model
- [ ] Cancellations archive contracts
- [ ] No fallback errors in logs

## Troubleshooting

### "Package vetting error"
- Ensure DAR is uploaded: `GET /v2/packages`
- Ensure DAR is vetted on all hosting participants

### "PARTY_NOT_KNOWN_ON_PARTICIPANT"
- User party may not be hosted on this participant
- Check party allocation via gRPC admin API

### Read model empty after restart
- ACS bootstrap may have failed
- Check Canton connectivity
- Verify operator party has observer rights

### WebSocket disconnects
- Token may have expired
- Implement token refresh in ReadModelService
