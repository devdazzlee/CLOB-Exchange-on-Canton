# Settlement: two legs for CC / CBTC (CLOB)

## What clients see

For a match, **two** on-chain allocations are created and **each** must run `Allocation_ExecuteTransfer`:

1. **Base leg** — seller → buyer (e.g. **CC** / Amulet).
2. **Quote leg** — buyer → seller (e.g. **CBTC** / Utilities).

The operator executes both (non-interactive); users do not sign at match time.

## Why not one allocation with both transfers?

**CC** and **CBTC** typically use **different** instrument admins and registry APIs (Amulet vs Utilities). Splice’s allocation factory is built around **one** instrument context per allocation. Mixing Amulet and Utilities in a **single** `AllocationFactory_Allocate` / multi-leg allocation is **not** reliably supported on devnet for this pair — so the backend uses **two** allocations and **two** executes.

If Splice later exposes a single supported path for cross-instrument legs, the engine could be switched; until then, **two legs is the correct pattern**.

## Order of operations (hardened)

To reduce registry **404** / “allocation not indexed yet” and stuck **active** allocations:

1. Withdraw both self-allocations.
2. **Delay** (`SETTLEMENT_REGISTRY_SETTLE_MS`, default `2500`).
3. Create **base** allocation → **delay** → **execute** base (`executeAllocationTransferDirect`).
4. Short pause, then create **quote** allocation → **delay** → **execute** quote.

Executing the **base** leg **before** creating the quote allocation avoids leaving a long-lived active `-leg-base` contract if the quote path fails later.

## Environment knobs

| Variable | Purpose |
|----------|---------|
| `SETTLEMENT_REGISTRY_SETTLE_MS` | Ms to wait after withdraws and before each execute (default `2500`). |
| `ALLOCATION_EXECUTE_REGISTRY_ATTEMPTS` | Registry `execute-transfer` context retries (default `8`). |
| `ALLOCATION_EXECUTE_REGISTRY_BACKOFF_MS` | Backoff between registry retries (default `3000`). |
| `ALLOCATION_EXECUTE_EXERCISE_ATTEMPTS` | Retries for `exerciseChoice` on execute (default `4`). |
| `ALLOCATION_EXECUTE_EXERCISE_BACKOFF_MS` | Backoff between exercise retries (default `2000`). |

## Failed vs successful trades

If settlement fails (e.g. missing allocation, registry lag, `CONTRACT_NOT_FOUND`), there is typically **no** `Settlement:Trade` / app “Transaction History” entry for that attempt — only successful paths record the trade after both legs execute and `FillOrder` runs as designed.
