# Tech debt — backlog (Tier 2 and Tier 3)

Deferred on purpose. The active list is [tech_debt.md](tech_debt.md) (Tier 1); nothing here is picked up until that file is empty, unless an item happens to fall inside a file already being changed.

| Tier | Meaning |
|---|---|
| **SHOULD — next** | Wrong or fragile behavior users will hit. Fix right after the Tier 1 items. |
| **CAN WAIT** | Real, but low blast radius. Cleanup / hygiene. |

IDs are stable (`TD-01` … `TD-17`) and match the numbering in [tech_debt.md](tech_debt.md). Severity is the one from the first review.

---

# Tier 2 — SHOULD (next)

Items TD-25 to TD-31 come from the review of 2026-09-12 (security, contracts, performance).

- [ ] **TD-25 · The CSV export can hang forever and pin an open SQLite iterator** — Severity: Medium
  - **Why here:** `await once(stream, 'drain')` has no timeout, and nothing listens for the response's `close`/`aborted` events. A client that stops reading once the socket buffer fills parks the promise permanently; the `better-sqlite3` iterator stays open with it, holding a read snapshot.
  - Where: [src/lib/csv.ts:71](src/lib/csv.ts:71), [src/routes/orders.ts:50](src/routes/orders.ts:50)
  - Scenario: a merchant opens many export connections with a tiny receive window and never reads — sockets, promises and WAL read snapshots accumulate, and they outlive the 10-minute token because the guard only runs at request start.

- [ ] **TD-26 · `metrics.summary()` aggregates the merchant's entire history on every dashboard load** — Severity: Medium
  - **Why here:** no date filter, plus a `COUNT(DISTINCT ...)` that needs a temp B-tree. `better-sqlite3` is synchronous, so the cost blocks every other request.
  - **Measured:** ~19.7 ms for a distinct-customer scan over 50 000 rows; at 1M rows this becomes a visible stall for all tenants, triggered by one merchant refreshing.
  - Where: [src/dal/metrics-repository.ts:47](src/dal/metrics-repository.ts:47)

- [ ] **TD-27 · Statements are re-prepared on every repository call** — Severity: Medium
  - **Why here:** `db.prepare()` runs per call and the statement is discarded; `better-sqlite3` does not cache. With the current tiny dataset, compiling the multi-`CASE` aggregates likely costs more than executing them.
  - Where: [src/dal/base-repository.ts:68](src/dal/base-repository.ts:68), [src/dal/base-repository.ts:94](src/dal/base-repository.ts:94), [src/dal/base-repository.ts:142](src/dal/base-repository.ts:142)

- [ ] **TD-28 · The dashboard serializes its API calls and re-mints once per call on expiry** — Severity: Medium
  - **Why here:** `refresh()` awaits summary → revenue → orders in sequence although none depends on the previous, and the 401 re-mint is per request: after the merchant token expires, one refresh becomes 3 × (401 + mint + retry) instead of one mint plus three parallel reads.
  - Where: [public/app.js:62](public/app.js:62), [public/app.js:30](public/app.js:30)

- [ ] **TD-29 · Error contracts disagree across endpoints** — Severity: Medium
  - **Why here:** the same user mistake gets three answers. Half a date range → `400 missing_date_range` on revenue, `400 invalid_date_range` on the export, and **200 with the filter silently dropped** on the orders list. Only those two routes add a `detail` field, so the error envelope is `{error, detail?}` in practice but documented as `{error}`. And `GET /api/auth/session` reports an expired token as `unauthenticated` instead of `session_expired`, so a client following the documented retry rule logs the user out instead of re-minting.
  - Where: [src/routes/revenue.ts:20](src/routes/revenue.ts:20), [src/routes/orders.ts:40](src/routes/orders.ts:40), [src/routes/orders.ts:64](src/routes/orders.ts:64), [src/routes/auth.ts:142](src/routes/auth.ts:142)

- [ ] **TD-30 · Docs lag the shipped API** — Severity: Medium
  - **Why here:** `GET /api/orders/export.csv` is entirely undocumented, `canSwitchMerchants` is missing from the session response, `invalid_date_range` is absent from the error table, and the `limit` caveat doesn't mention that `?limit=-1` returns everything while `?limit=abc` is a 500.
  - Where: [docs/api.md](docs/api.md)

- [ ] **TD-31 · `role` and `scope` are independent claims that encode one thing** — Severity: Medium
  - **Why here:** `verifyToken` accepts any combination and only requires `merchantId` when `role === 'merchant'`; the guard compares `scope` alone. A `{role:'admin', scope:'data'}` token would pass the data guard with no merchant id and fail deeper as a `500` instead of a `403`. Not reachable today (only the two issuer helpers sign tokens), so this is defence in depth.
  - Where: [src/auth/jwt.ts:88](src/auth/jwt.ts:88), [src/auth/guard.ts:63](src/auth/guard.ts:63)

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

- [ ] **TD-32 · Money and identifier fields are named inconsistently across the API** — Severity: Low
  - **Why here:** `total_spent` is the only money field without a `_cents` suffix, so a client would render `$181,968` instead of `$1,819.68`. The merchant identifier appears as `merchantId` (session), `merchant_id` (metrics, revenue, CSV) and `X-Merchant-Id` (header); the session normalizes it to `null` while the other routes spread an `undefined` that `JSON.stringify` drops, so the key disappears entirely.
  - Where: [src/dal/metrics-repository.ts:35](src/dal/metrics-repository.ts:35), [src/routes/auth.ts:126](src/routes/auth.ts:126), [src/routes/metrics.ts:19](src/routes/metrics.ts:19)

- [ ] **TD-33 · The dashboard ships without security response headers** — Severity: Low
  - **Why here:** no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` or `Referrer-Policy`, so the known XSS sink (TD-12) has no backstop and the page is framable.
  - Where: [src/app.ts:37](src/app.ts:37)

- [ ] **TD-34 · The JWT secret has no strength floor and is written world-readable** — Severity: Low
  - **Why here:** any non-empty `JWT_SECRET` is accepted (`JWT_SECRET=dev` included), and the generated one is appended to `.env` with default permissions and no explicit `mode`. `readEnvValue` takes the **first** match while `process.loadEnvFile` applies **last**-wins, so a concurrent `npm run dev` + `npm run token` on a fresh checkout can leave two secrets and reject every CLI token as `session_expired`.
  - Where: [src/config/env.ts:71](src/config/env.ts:71), [src/config/env.ts:94](src/config/env.ts:94)

- [ ] **TD-35 · A failure before the first byte aborts the socket instead of answering** — Severity: Low
  - **Why here:** the export sets headers, then `res.destroy()` on any error, even when nothing has been written yet — the client sees a connection reset rather than a readable status. Checking `res.headersSent` would let the early case return a normal error.
  - Where: [src/routes/orders.ts:51](src/routes/orders.ts:51)

- [ ] **TD-36 · Tests are not type-checked, and the Express types don't match the runtime** — Severity: Low
  - **Why here:** `tsconfig.json` includes only `src/**`, so `npm run build` never checks `test/`, which leans on `!` assertions. Separately, `@types/express` is 5.x while the runtime is Express 4.22.2, so the compiler validates against a major version the app does not run.
  - Where: [tsconfig.json](tsconfig.json), [package.json](package.json)


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
