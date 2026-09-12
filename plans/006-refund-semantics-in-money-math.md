# 006 — Refund semantics in money math

**Status:** done (2026-09-12, rev 2) — implemented, validated locally, `docs/` updated

Closes Tier 1 group **E** (TD-05) from [tech_debt.md](../tech_debt.md), and TD-06 from [tech_debt_backlog.md](../tech_debt_backlog.md) since both are the same bug in two places.

## Context

`orders.type` is `'sale' | 'refund'`, and per [docs/architecture.md](../docs/architecture.md) a refund records a reversed sale. But refunds are stored with a **positive** `total_amount`, and every money query sums `total_amount` without looking at `type`. So a refund *increases* revenue.

Measured on the current seeded database:

| Merchant | Sales | Refunds | Reported today | Correct (net) | Overstated by |
|---|---|---|---|---|---|
| `m_acme` | 375 736 | 48 628 | 424 364 | 327 108 | **+29.7 %** |
| `m_bistro` | 383 990 | 33 669 | 417 659 | 350 321 | **+19.2 %** |

A refund doesn't just fail to subtract — it adds the same amount again, so the error is roughly twice the refunded volume. This is the number the product exists to show, wrong in the optimistic direction.

Schema facts that shape the fix (verified against the database):

- `total_amount` is always positive, for both types.
- There is **no column linking a refund to the sale it reverses** — netting can only be amount-based (logged as TD-18).
- Every row is `status = 'completed'`; no other status exists yet.

## Decision

### 1. One definition of money, in one place

All money math moves behind named SQL expressions in `OrdersRepository`, so no route or repository can invent its own:

```ts
/** Signed amount: sales add, refunds subtract. */
const NET_AMOUNT = "CASE WHEN type = 'refund' THEN -total_amount ELSE total_amount END";
const SALES_ONLY = "CASE WHEN type = 'sale' THEN total_amount ELSE 0 END";
const REFUNDS_ONLY = "CASE WHEN type = 'refund' THEN total_amount ELSE 0 END";
```

Rejected alternative: **store refunds as negative amounts**. It makes every query trivially correct, but it rewrites existing rows (migration + backfill), breaks the documented meaning of `total_amount`, and makes "how much did we refund" harder to ask. Netting at read time keeps the raw facts intact.

### 2. `GET /api/revenue` returns net revenue, with the breakdown (Q3)

```json
{
  "merchant_id": "m_acme",
  "from": "2026-08-01", "to": "2026-09-12",
  "revenue_cents": 327108,
  "revenue": 3271.08,
  "gross_sales_cents": 375736,
  "refunds_cents": 48628
}
```

`revenue_cents` keeps its name and becomes **net** (sales − refunds). The two new fields make the number auditable: a merchant seeing revenue drop can tell whether sales fell or refunds rose.

Net revenue **can be negative** (a period with only refunds). That's correct and is asserted by a test rather than clamped to zero.

### 3. `GET /api/metrics/summary` (Q1, Q2 — both figures, named explicitly)

```json
{
  "merchant_id": "m_acme",
  "sales_orders": 35,
  "refund_orders": 5,
  "unique_customers": 3,
  "avg_order_value_cents": 10735,
  "avg_net_order_value_cents": 9346
}
```

| Field | Meaning |
|---|---|
| `sales_orders` | Rows of type `sale` |
| `refund_orders` | Rows of type `refund` |
| `unique_customers` | Distinct customers **with at least one sale** |
| `avg_order_value_cents` | Average amount of a sale — "what does a typical order look like" |
| `avg_net_order_value_cents` | Net revenue ÷ number of sales — what a sale is worth *after* refunds |

The ambiguous `total_orders` is **removed** rather than redefined: per Q2 the two counts get dedicated names so nobody has to guess whether refunds are included. Any client reading `total_orders` gets `undefined` instead of a silently changed meaning — a loud break rather than a quiet one, and the only client is this repo's dashboard.

### 4. `GET /api/metrics/top-customers` ranks by net spend

`total_spent` becomes net per customer (sales − refunds) and `order_count` counts sales. A customer who refunded everything ranks last instead of top — which is the point of the report.

### 5. `status` is ignored for now (Q4)

Every row is `completed`; filtering would be untested speculation. If other statuses ever appear, money math must exclude the non-completed ones — noted in the docs so it isn't forgotten.

### 6. Gate against regression

- **Unit tests on the repository** with a fixed dataset (golden numbers), plus property-style cases: a fully refunded period nets to `0`; a refunds-only period is negative; adding a sale and its refund leaves revenue unchanged.
- **Architecture test extension:** `total_amount` may only be summed inside `src/dal/`. A route or script computing money on its own fails the suite. This is what stops the next endpoint from re-introducing the bug.

### 7. Dashboard

Cards become: **Sales orders**, **Refunds**, **Avg order value**, **Revenue (last 30 days, net of refunds)**, with a small line under revenue showing gross and refunded amounts. Without the relabel the headline number just drops ~20–30 % with no explanation.

### 8. Commits

| # | Content | Tech debt |
|---|---|---|
| 1 | `OrdersRepository`: net expressions + `revenue()` breakdown; revenue route; tests | TD-05 |
| 2 | `MetricsRepository`: sales/refund counts, both averages, net `total_spent`; metrics routes; tests | TD-06 |
| 3 | Architecture test extension (money math only inside `src/dal/`) | — |
| 4 | Dashboard cards and labels | — |

## Answers to the open questions

- **Q1 — Both averages**: `avg_order_value_cents` (sales only) and `avg_net_order_value_cents` (net ÷ sales).
- **Q2 — Both counts, dedicated names**: `sales_orders` and `refund_orders`; `total_orders` removed.
- **Q3 — Yes**, revenue response carries `gross_sales_cents` and `refunds_cents`.
- **Q4 — Ignore `status`** for now.
- **Q5 — Logged** as TD-18 in `tech_debt_backlog.md` (no way to match a refund to its original sale).

## Scope

- `src/dal/orders-repository.ts`, `src/dal/metrics-repository.ts`
- `src/routes/revenue.ts`, `src/routes/metrics.ts`
- `public/index.html`, `public/app.js`
- `test/base-repository.test.ts`, new `test/money.test.ts`, `test/architecture.test.ts`, `test/auth-guard.test.ts` (updated expectations)

## Out of scope

- Input validation (TD-10, TD-11) and XSS (TD-12) — groups C and D.
- Date-range semantics (TD-07) and mixed timestamp formats (TD-08) — backlog; the `created_at` filters are untouched.
- Storing refunds as negative amounts, or adding a refund→sale link (TD-18).
- `docs/` updates — authorization to be requested after validation (CLAUDE.md §6): `api.md` (response shapes) and `architecture.md` (the refund rule).

## Validation

1. `npm test` — new money tests plus the existing suite.
2. `tsc --noEmit` → exit 0.
3. Golden check against the seeded database: `m_acme` revenue reports `327108`, not `424364`; `m_bistro` `350321`, not `417659`.
4. `curl /api/revenue` → net plus gross and refunds, reconciling (`gross - refunds === net`).
5. `curl /api/metrics/summary` → `sales_orders + refund_orders` equals the old `total_orders`; both averages present and different when refunds exist.
6. `top-customers`: a customer with more refunds than sales shows a negative `total_spent` and ranks last.
7. Browser: cards read "Sales orders" / "Refunds" / "Revenue (… net of refunds)" with the gross/refunds line, matching the API.
8. Architecture test fails if a route sums `total_amount` (verified by temporarily adding such a line).

## Rollback

Revert the commits. No schema or data migration is involved — the fix is read-side only, so rolling back cannot corrupt stored rows.

## Results

| Step | Result |
|---|---|
| 1. `npm test` | ✅ 63/63 (11 new money tests) |
| 2. `tsc --noEmit` | ✅ exit 0 |
| 3. Golden check (seeded db) | ✅ `m_acme` revenue `327108` (was `424364`), `m_bistro` `350321` (was `417659`) |
| 4. `/api/revenue` | ✅ `{revenue_cents: 327108, gross_sales_cents: 375736, refunds_cents: 48628}` — reconciles |
| 5. `/api/metrics/summary` | ✅ `m_acme` `sales_orders: 34` + `refund_orders: 6` = the old total of 40; `avg_order_value_cents: 11051` vs `avg_net_order_value_cents: 9621` |
| 6. `top-customers` | ✅ ranked by net spend; `order_count` counts sales only (negative-spend case covered by unit test) |
| 7. Browser | ✅ cards read Sales orders / Refunds / Avg order value (+ "net of refunds") / "Revenue (last 30 days, net of refunds)" with `$1,688.33 sales − $192.36 refunded` under `$1,495.97` |
| 8. Gate is real | ✅ added `// SUM(total_amount)` to `src/routes/revenue.ts` → architecture test failed; removed it → 63/63 again |

### Notes

- Money expressions live in `src/dal/money.ts` (`NET_AMOUNT`, `SALES_ONLY`, `REFUNDS_ONLY`, `SALE_COUNT`, `REFUND_COUNT`), shared by both repositories.
- `total_orders` is gone from `/api/metrics/summary`, replaced by `sales_orders` + `refund_orders` (Q2). The dashboard was updated in the same change; no other client exists.
- `status` is still ignored (Q4): every row is `completed`.
- TD-18 (no link between a refund and the sale it reverses) is logged in `tech_debt_backlog.md`; amount-based netting is exact in total but cannot answer "was *this* sale refunded".
