# Diagram Corrections for CLOB Exchange User Flow

## Issues Found in Current Diagram

### ✅ **CORRECT Sections:**
1. **Phase 1: User Onboarding & Wallet Setup** - Accurate
2. **Phase 4: Order Management** - Accurate
3. **Overall structure and flow** - Good

### ⚠️ **CORRECTIONS NEEDED:**

#### **Correction 1: Phase 2 - Party Registration Timing**

**Current Diagram Shows:**
- UserAccount check → If No → Party Registration → Display balances

**Actual Implementation:**
- **Party Registration happens DURING wallet creation** (in Phase 1), not after UserAccount check
- The flow should be:
  - Wallet Creation → **Party Registration (automatic)** → Store party ID
  - Then in Phase 2: UserAccount check → Display balances

**Corrected Flow:**
```
Phase 1 (Wallet Setup):
  - Generate key pair
  - Display seed phrase
  - Store encrypted private key
  - **Backend creates Canton party (automatic)**
  - **Grant user rights (automatic)**
  - **Store party ID**

Phase 2 (Account Setup):
  - Check UserAccount contract exists?
  - If No: Display "UserAccount needs creation by operator"
  - If Yes: Display balances
```

#### **Correction 2: Phase 3 - Order Matching is Automatic**

**Current Diagram Shows:**
- Add order to OrderBook → **Decision: Order matches?** → If Yes: Execute trade

**Actual Implementation:**
- **Order matching happens AUTOMATICALLY** when `AddOrder` is called
- In DAML code (OrderBook.daml line 159): `exercise orderBookCid MatchOrders` is called immediately after creating the order
- There's no separate decision point - matching is automatic

**Corrected Flow:**
```
Order Placement:
  - Submit order
  - Check OrderBook exists? (If No: Create OrderBook)
  - Exercise AddOrder choice on OrderBook
  - **AddOrder automatically:**
    1. Creates Order contract
    2. Adds order to OrderBook
    3. **Automatically triggers MatchOrders**
    4. If match found: Execute trade, update balances
    5. If no match: Order stays in order book
  - Update order book display
```

#### **Correction 3: Phase 5 - Real-time Updates Method**

**Current Diagram Shows:**
- "WebSocket connection maintains live order book"

**Actual Implementation:**
- Uses **polling every 5 seconds**, not WebSocket
- WebSocket was discussed but not implemented in current codebase

**Corrected:**
```
Phase 5: Real-time Updates
  - Polling every 5 seconds for:
    - Balance updates
    - Order status updates
    - Order book updates
  - Display latest trades and order book changes
```

---

## Corrected Diagram Description

Here's the corrected flow for **Phase 3: Trading Interface**:

```
**Phase 3: Trading Interface (Blue Section)**

1. User selects trading pair (BTC/USDT, ETH/USDT, etc.)

2. Order Book Display:
   - Show buy orders (sorted by price descending)
   - Show sell orders (sorted by price ascending)
   - Updates via polling every 5 seconds

3. Order Placement:
   - User selects order type (Limit or Market)
   - User selects side (Buy or Sell)
   - Enter price (for limit orders) and quantity
   - Submit order

4. Order Processing (AUTOMATIC):
   - Decision: OrderBook contract exists?
     - If No: Create OrderBook contract
     - If Yes: Continue
   - Exercise AddOrder choice on OrderBook
   - **AddOrder automatically:**
     * Creates Order contract
     * Adds order to buyOrders or sellOrders array
     * **Automatically calls MatchOrders**
     * MatchOrders checks for compatible orders:
       - If match found: Execute trade, update balances, create Trade contract
       - If no match: Order stays in order book
   - Update order book display
```

---

## Summary of Changes

1. ✅ Move Party Registration to Phase 1 (during wallet creation)
2. ✅ Remove "Order matches?" decision point - matching is automatic
3. ✅ Change "WebSocket" to "Polling every 5 seconds" in Phase 5
4. ✅ Clarify that MatchOrders is called automatically by AddOrder

The rest of the diagram is accurate and can be sent to the client with these corrections applied.

