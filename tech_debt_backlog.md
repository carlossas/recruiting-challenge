# Tech debt — backlog (Tier 2 and Tier 3)

Deferred on purpose. The active list is [tech_debt.md](tech_debt.md) (Tier 1); nothing here is picked up until that file is empty, unless an item happens to fall inside a file already being changed.

| Tier | Meaning |
|---|---|
| **SHOULD — next** | Wrong or fragile behavior users will hit. Fix right after the Tier 1 items. |
| **CAN WAIT** | Real, but low blast radius. Cleanup / hygiene. |

IDs are stable (`TD-01` … `TD-17`) and match the numbering in [tech_debt.md](tech_debt.md). Severity is the one from the first review.

---

# Tier 2 — SHOULD (next)

- [ ] **TD-18 · A refund can't be matched to the sale it reverses** — Severity: Medium
  - **Why here:** found while designing [plan 006](plans/006-refund-semantics-in-money-math.md). Netting revenue by amount makes the totals right, but nothing ties a refund row to its original sale, so the data can't answer "was this sale refunded?", a refund can exceed the sale it reverses, and a refund recorded in a later period makes that period negative while the earlier one stays overstated. Partial refunds are indistinguishable from unrelated ones.
  - Where: [src/db.ts:23](src/db.ts:23) (the `orders` table has no parent/order reference)
  - What happens: `orders` holds `id, merchant_id, customer_email, total_amount, type, status, created_at` — and no link column. Shape to decide: a nullable `refunded_order_id` referencing `orders(id)`, plus a rule for how much of a sale may be refunded.

- [ ] **TD-16 · Test coverage is minimal** — Severity: Medium
  - **Why here:** the gate that keeps Tier 1 fixed. Right now nothing would catch a regression in auth, tenancy scoping, or revenue math.
  - Where: [test/orders.test.ts](test/orders.test.ts)
  - What happens: only the DAL's `create`, `listByMerchant`, and `getById` are covered. No route, auth, revenue, or metrics tests.

- [x] **TD-06 · Summary metrics treat refunds as sales** — Severity: Medium — **resolved**
  - Resolved by [plan 006](plans/006-refund-semantics-in-money-math.md), folded into the TD-05 change as expected: `MetricsRepository` now reports `sales_orders` and `refund_orders` separately, counts only customers with a sale, exposes both `avg_order_value_cents` (per sale) and `avg_net_order_value_cents` (net per sale), and ranks `top-customers` by net spend. Covered by `test/money.test.ts`.

- [ ] **TD-07 · The revenue range excludes the `to` day, so the dashboard leaves out today** — Severity: Medium
  - **Why here:** a visibly wrong number every day, with an obvious fix, but it under-reports rather than overstating.
  - Where: [src/dal/orders-dal.ts:59](src/dal/orders-dal.ts:59), [public/app.js:28](public/app.js:28)
  - What happens: the filter is `created_at < to` with `to` as a `YYYY-MM-DD` date, so the whole `to` day is excluded — and the frontend sends `to = today`.

- [ ] **TD-08 · `created_at` is stored in mixed formats** — Severity: Medium
  - **Why here:** data-integrity debt that gets more expensive the more rows accumulate, and it quietly corrupts ordering and range filters.
  - Where: [src/db.ts:30](src/db.ts:30), [src/scripts/seed.ts:21](src/scripts/seed.ts:21)
  - What happens: the seed stores ISO 8601 (`2026-09-10T12:00:00.000Z`) while `POST`-created orders use SQLite's `DEFAULT CURRENT_TIMESTAMP` (`2026-09-10 12:00:00`). Comparisons and `ORDER BY` are string-based, so ordering within a day can be wrong; the browser also reads the format without `T`/`Z` as local time.

- [ ] **TD-03 · `POST /api/orders` with a non-existent merchant returns 500** — Severity: Medium
  - **Why here:** wrong status code and a leaked internal error, not a data or money problem. Largely disappears once TD-01 is fixed.
  - Where: [src/routes/orders.ts:35](src/routes/orders.ts:35)
  - What happens: an unknown `merchantId` violates the `orders.merchant_id → merchants.id` FK (`foreign_keys = ON`); the exception reaches the generic handler and returns `500 internal_error`.

---

# Tier 3 — CAN WAIT

- [ ] **TD-09 · `from`/`to` are not validated** — Severity: Low
  - **Why here:** garbage dates produce empty or odd results for the caller who sent them; no cross-tenant or money impact. Natural companion to TD-10/TD-11 (Tier 1, group C) if that validation shape is reusable.
  - Where: [src/routes/revenue.ts:12](src/routes/revenue.ts:12), [src/routes/orders.ts:9](src/routes/orders.ts:9)
  - What happens: any string is accepted and compared lexicographically. In `GET /api/orders`, sending only one of the two parameters silently drops the filter.

- [ ] **TD-13 · The frontend doesn't handle API errors** — Severity: Low
  - **Why here:** poor UX, not incorrect data — although "silently shows `$0.00` on a 500" can be mistaken for real data.
  - Where: [public/app.js:8](public/app.js:8)
  - What happens: `api()` never checks `r.ok`, so error responses are rendered as empty values.

- [ ] **TD-14 · The merchant list is hardcoded in the HTML** — Severity: Low
  - **Why here:** demo-scaffolding duplication; it will be revisited anyway when real auth lands (TD-01).
  - Where: [public/index.html:28](public/index.html:28)
  - What happens: the selector duplicates [src/scripts/seed.ts:4](src/scripts/seed.ts:4) instead of coming from the API.

- [x] **TD-17 · `docs/architecture.md` is outdated** — Severity: Low — **resolved**
  - Resolved alongside [plan 005](plans/005-jwt-auth-and-scoped-repositories.md): `docs/architecture.md` was rewritten (auth layer, repository base class, configuration, request flow) and `docs/api.md` now documents the session model. The stale `lib/` reference and the "unmaintained draft" banner are gone.

- [ ] **TD-15 · `npm run seed` probably does nothing on Windows** — Severity: Low
  - **Why last:** masked in practice — the server calls `seedIfEmpty()` on startup — so the visible impact is zero today.
  - Where: [src/scripts/seed.ts:60](src/scripts/seed.ts:60)
  - What happens: the `isMain` check compares `import.meta.url` (`file:///C:/...`) against `process.argv[1]` (`C:\...`), so neither condition matches.
