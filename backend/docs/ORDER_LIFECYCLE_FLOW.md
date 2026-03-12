# Order Lifecycle Flow — From Placement to Settlement

Detailed flow of activities from order placement through settlement.

---

## 1. Order Placement (User Signs Once)

### 1.1 Balance Check
- Backend verifies user has sufficient available balance for the order
- For **SELL**: requires base token (e.g. CC)
- For **BUY**: requires quote token (e.g. CBTC) = `price × quantity`

### 1.2 Balance Reservation
- Backend reserves the required amount in PostgreSQL (`OrderReservation`)
- Prevents overselling / double-use before on-chain lock

### 1.3 Allocation Creation (Interactive — User Signs)
- User signs a **single** interactive transaction
- **AllocationFactory_Allocate** is exercised:
  - **Sender**: user (order placer)
  - **Receiver**: operator (exchange)
  - **Executor**: operator
  - **Amount**: exact order quantity (e.g. 0.1 CC for sell, 0.001 CBTC for buy)
- This creates an **Allocation** contract on Canton
- The allocation has a **lock** context — tokens are locked, NOT transferred yet
- Allocation contract ID is stored in `OrderReservation` and on the Order contract

### 1.4 Order Contract Creation (Same Session, Auto-Signed)
- After allocation succeeds, backend creates the **Order** contract on Canton
- Order references `allocationCid` (the allocation contract ID)
- Order status: **OPEN**

**Result:** Tokens are locked on-chain. User has signed once.

---

## 1.5 Post-Settlement: Orphaned Allocation Cleanup

After settlement, some Splice deployments leave Allocation contracts active (orphaned).
The backend attempts `Allocation_Cancel` to release them. This requires:
- **Owner** (sender) signing key — stored during onboarding/rehydrate
- **Executor** (operator) signing key — must be stored separately

To fix "lock holding contract still visible after settlement":
```bash
# Store operator key (get from Canton participant config)
OPERATOR_SIGNING_KEY_BASE64=<base64> OPERATOR_PUBLIC_KEY_FINGERPRINT=<hex> node scripts/store_operator_signing_key.js
```

Verify by checking holdings via the balance API.

---

## 2. Matching (Background — No User Action)

### 2.1 Polling
- Matching engine polls Canton every few seconds for active **OPEN** orders
- Filters by trading pair (e.g. CC/CBTC)
- Sorts by price-time priority (FIFO)

### 2.2 Match Detection
- Finds crossing orders: buy price ≥ sell price
- Computes match quantity (min of buy remaining, sell remaining)

### 2.3 Allocation Check
- Both orders must have a valid `allocationContractId`
- If missing, order is skipped (no settlement)

---

## 3. Settlement (Operator Only — No User Signature)

### 3.1 Step 1: Execute Original Allocations

**Seller allocation:**
- `Allocation_ExecuteTransfer` on seller's allocation contract
- Tokens move: **seller → operator** (base token, e.g. CC)
- Allocation contract is **consumed/archived** — the lock is released

**Buyer allocation:**
- `Allocation_ExecuteTransfer` on buyer's allocation contract  
- Tokens move: **buyer → operator** (quote token, e.g. CBTC)
- Allocation contract is **consumed/archived**

### 3.2 Step 2: Standard Transfers (Operator → Counterparty)

**Leg A — Base to buyer:**
- `TransferFactory_Transfer`: operator → buyer (base tokens)
- Creates `TransferInstruction`; auto-accept service accepts on behalf of buyer

**Leg B — Quote to seller:**
- `TransferFactory_Transfer`: operator → seller (quote tokens)
- Creates `TransferInstruction`; auto-accept service accepts on behalf of seller

### 3.3 Step 3: Fill Orders
- `FillOrder` exercised on both Order contracts
- Updates filled quantity, remaining quantity
- For partial fills: `newAllocationCid` can be null (current implementation)

### 3.4 Step 4: Record Trade
- Trade record created in PostgreSQL
- Trade contract created on Canton (for history)
- Balance reservations released

**Result:** Tokens transferred. Allocation contracts archived. Holding contracts updated.

---

## 4. Order Cancellation (User-Initiated)

- User cancels order via API
- `CancelOrder` exercised on Order contract
- `Allocation_Cancel` exercised on allocation contract
- Allocation is **consumed** — tokens unlocked and returned to user
- Balance reservation released

---

## 5. Summary Table

| Phase | Who | What |
|-------|-----|------|
| Place order | User (1 signature) | Allocation created + Order created |
| Match | Backend | Find crossing orders |
| Settle | Operator only | Execute allocations → Transfer to counterparty → FillOrder |
| Cancel | User | CancelOrder + Allocation_Cancel |

---

## 6. Lock / Allocation Contract After Settlement

**Expected:** When `Allocation_ExecuteTransfer` succeeds, the allocation contract (including its lock context) is **archived** — it should no longer appear as active.

**If you still see an active lock contract after settlement:**

1. **Order was never matched** — No crossing buy/sell order existed. The allocation stays active until the order is matched or cancelled.
2. **Settlement failed** — Check backend logs for errors during `Allocation_ExecuteTransfer` or `performTransfer`.
3. **Order ID mismatch** — Confirm the allocation is for the same order that was settled (check `order-1773249815108-9cf5a0d4` in logs).
4. **Different contract type** — The Splice standard may have separate contracts (e.g. Lock vs Allocation). Ensure you're querying the same contract that was exercised.

**Verification:** Run `node verify_holdings.js` for the parties after a trade to confirm Holding contracts reflect the new balances.
