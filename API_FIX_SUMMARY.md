# ✅ API Endpoint Fix Summary

## Problem
The code was using **non-existent v1 endpoints** (`/v1/query`, `/v1/create`, `/v1/exercise`) which don't exist in Canton JSON Ledger API.

## Solution
Updated to use **official Canton JSON Ledger API v2 endpoints** per documentation:
- https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html

## Changes Made

### 1. API Version
- Changed from `v1` to `v2`

### 2. Endpoints Updated

#### Query Contracts
- **OLD:** `POST /v1/query`
- **NEW:** `POST /v2/state/active-contracts`
- **Request Format:**
  ```json
  {
    "filter": {
      "templateIds": ["UserAccount:UserAccount"]
    }
  }
  ```
- **Response Format:**
  ```json
  {
    "activeContracts": [...]
  }
  ```

#### Create Contract
- **OLD:** `POST /v1/create`
- **NEW:** `POST /v2/commands/submit-and-wait`
- **Request Format:**
  ```json
  {
    "commands": [
      {
        "CreateCommand": {
          "templateId": "UserAccount:UserAccount",
          "createArguments": {...}
        }
      }
    ],
    "actAs": ["party-id"]
  }
  ```

#### Exercise Choice
- **OLD:** `POST /v1/exercise`
- **NEW:** `POST /v2/commands/submit-and-wait`
- **Request Format:**
  ```json
  {
    "commands": [
      {
        "ExerciseCommand": {
          "contractId": "...",
          "choice": "Deposit",
          "exerciseArgument": {...}
        }
      }
    ],
    "actAs": ["party-id"]
  }
  ```

#### Fetch Contract
- **OLD:** `POST /v1/fetch`
- **NEW:** `POST /v2/state/active-contracts`
- **Request Format:**
  ```json
  {
    "filter": {
      "contractIds": ["contract-id"]
    }
  }
  ```

## Files Updated
- ✅ `frontend/src/services/cantonApi.js` - Complete rewrite using v2 API

## Next Steps
1. Restart frontend: `cd frontend && yarn dev`
2. Hard refresh browser: `Ctrl+Shift+R`
3. Test wallet creation and order placement
4. Verify API calls work correctly

## Documentation Links
- Official OpenAPI Spec: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
- JSON API Tutorial: https://docs.digitalasset.com/build/3.3/tutorials/json-api/canton_and_the_json_ledger_api.html
- JSON API Explanation: https://docs.digitalasset.com/build/3.4/explanations/json-api/index.html

