# Tech debt — Tier 1 (MUST, urgent)

The items we're working on now. Everything else lives in [tech_debt_backlog.md](tech_debt_backlog.md) (Tier 2 and Tier 3) and is deliberately out of sight until this file is empty.

## How this is ranked

Priority balances **product impact** against **security and financial risk**, not raw severity:

- An item that lets an attacker read another merchant's data, or that can cost money, outranks an item that only shows a wrong number on a dashboard.
- Items that **amplify each other** are ranked together — an unbounded `limit` (TD-10) is worth more to an attacker the weaker the tenancy boundary is.
- Wrong revenue math (TD-05) is ranked here anyway: merchants make decisions with that number, and it overstates income.

IDs are stable (`TD-01` … `TD-17`) and don't change when the order does. Severity is the one from the first review.

## Groups at a glance

Items are grouped by the domain and files they touch, so each group can land as one commit.

| Group | Items | Files | Status |
|---|---|---|---|
| **A — Tenancy scoping through the DAL** | TD-02, TD-04 | `dal/`, `routes/orders.ts`, `routes/metrics.ts` | ✅ Done — [plan 005](plans/005-jwt-auth-and-scoped-repositories.md) |
| **B — Authentication layer** | TD-01 | `auth/`, `server.ts`, `public/app.js` | ✅ Done — [plan 005](plans/005-jwt-auth-and-scoped-repositories.md) |
| **C — Input validation at the API edge** | TD-10, TD-11, **TD-19** | `routes/orders.ts`, `routes/metrics.ts` | ⬜ Open |
| **D — Output escaping in the dashboard** | TD-12 | `public/app.js` | ⬜ Open |
| **F — Money in the CSV export** | **TD-20** | `routes/orders.ts` | ⬜ Open |
| **G — Request robustness** | **TD-21** | `auth/cookies.ts` | ⬜ Open |
| **H — Auth gate hardening (before any deploy)** | **TD-23, TD-24** | `auth/local.ts`, `auth/dev-session.ts`, `routes/auth.ts` | ⬜ Open |
| **I — Query performance** | **TD-22** | `db.ts` | ⬜ Open |
| **E — Refund semantics in money math** | TD-05 | `dal/`, `routes/revenue.ts`, `routes/metrics.ts` | ✅ Done — [plan 006](plans/006-refund-semantics-in-money-math.md) |

Suggested order for what's left: **C (TD-19 first) → F → G → I → D → H**. TD-19 and TD-20 corrupt money that merchants read; TD-21 is a free 500 for any caller; TD-22 is a two-line index. D makes rendering safe regardless of what is already stored. H is ranked last only because nothing is deployed yet — **promote it to the top the moment this runs behind a proxy or on a shared host.**

Items TD-19 to TD-24 come from the review of 2026-09-12 (security, contracts, performance).

---

## Group C — Input validation at the API edge

*Files: [src/routes/orders.ts](src/routes/orders.ts), [src/routes/metrics.ts](src/routes/metrics.ts)*

Both are "the API trusts whatever the client sends". Same layer, same kind of fix (one validation shape applied to query params and body).

- [ ] **TD-10 · `limit` is not validated** — Severity: Medium
  - **Why here:** in SQLite `LIMIT -1` means "no limit", so `?limit=-1` returns every order of the merchant in one request — an easy way to exhaust the server, and a bulk export of everything a compromised session can reach.
  - Where: [src/routes/orders.ts:11](src/routes/orders.ts:11), [src/routes/metrics.ts:43](src/routes/metrics.ts:43)
  - What happens: `Number(req.query.limit)` can yield `NaN`, a decimal, or a negative number. There is no upper bound.

- [ ] **TD-11 · The `POST /api/orders` body is barely validated** — Severity: Medium
  - **Why here:** it's the entry point that feeds TD-12, and it lets corrupt money into the database — negative or fractional amounts in a column that holds integer cents.
  - Where: [src/routes/orders.ts:25](src/routes/orders.ts:25)
  - What happens: `type` accepts any string (not only `sale`/`refund`), `total_amount` accepts negatives and decimals, and `customer_email` isn't validated as an email.

- [ ] **TD-19 · An unknown `type` is counted as income and breaks the documented revenue invariant** — Severity: High
  - **Why here:** it corrupts the number plan 006 just fixed, through the hole TD-11 leaves open. `NET_AMOUNT` treats anything that is not exactly `'refund'` as a sale (`ELSE` branch), while `SALE_COUNT` only counts exactly `'sale'`.
  - **Verified live:** posting `{"type":"chargeback","total_amount":50000}` moved `revenue_cents` from `327108` to `377108` while `gross_sales_cents` (375736) and `refunds_cents` (48628) stayed put — so `gross - refunds === net`, which [docs/api.md](docs/api.md) states "always holds", is false. `avg_net_order_value_cents` also rose above `avg_order_value_cents`, which should be impossible when refunds exist.
  - Where: [src/routes/orders.ts:126](src/routes/orders.ts:126) (accepts any `type`), [src/dal/money.ts:15](src/dal/money.ts:15) (`ELSE` branch), [src/db.ts:29](src/db.ts:29) (no `CHECK` constraint)
  - Note: `"refund "` with a trailing space is counted as income too.

## Group F — Money in the CSV export

*File: [src/routes/orders.ts](src/routes/orders.ts)*

- [ ] **TD-20 · The CSV `amount` column is unsigned, so summing it recreates TD-05 in the spreadsheet** — Severity: High
  - **Why here:** the export exists so merchants can do their own math. `signed_amount_cents` is correct, but the human-readable `amount` column is `amount_cents / 100` — always positive. A merchant who sums the friendly column gets sales *plus* refunds, which is exactly the bug plan 006 removed from the API. Introduced by plan 008.
  - **Verified:** a refund row exports as `4000,-4000,40.00`.
  - Where: [src/routes/orders.ts:100](src/routes/orders.ts:100)
  - Also: `amount` is absent from `OrderExportRow` and from the API docs, and it is the only money column without a `_cents` suffix.

## Group G — Request robustness

*File: [src/auth/cookies.ts](src/auth/cookies.ts)*

- [ ] **TD-21 · A malformed cookie makes every route return 500** — Severity: Medium
  - **Why here:** unauthenticated, one header, affects every request including static assets — and it is a three-line fix.
  - **Verified live:** `curl -H 'Cookie: x=%' /api/health` → `500 {"error":"internal_error"}` plus a stack trace in the logs. `decodeURIComponent` throws `URIError` on invalid percent-encoding and nothing catches it.
  - Where: [src/auth/cookies.ts:38](src/auth/cookies.ts:38)
  - Worse with TD-12: `document.cookie = "junk=%"` would brick the dashboard for that browser until the user clears cookies by hand.

## Group H — Auth gate hardening (before any deploy)

*Files: [src/auth/local.ts](src/auth/local.ts), [src/auth/dev-session.ts](src/auth/dev-session.ts), [src/routes/auth.ts](src/routes/auth.ts)*

- [ ] **TD-23 · `isLocalRequest` is half client-controlled, so the dev admin session opens up behind a proxy** — Severity: High (conditional on deployment)
  - **Why here:** the gate is "loopback peer **and** `Host: localhost`". Behind anything terminating HTTP on the same host (nginx, a sidecar, an SSH tunnel), the peer address is always `127.0.0.1`, and the `Host` header is attacker-supplied. `DEV_ADMIN_SESSION` defaults to `on`, so a deployment that never sets it hands an 8h admin cookie to whoever asks with the right `Host` — and from there a merchant token for every tenant via `/api/merchants` and `/api/auth/token`.
  - Where: [src/auth/local.ts:50](src/auth/local.ts:50), [src/auth/dev-session.ts:36](src/auth/dev-session.ts:36), [src/config/env.ts:52](src/config/env.ts:52)
  - Shape to decide: default `DEV_ADMIN_SESSION` to `off`, require an explicit opt-in env var, and/or drop the `Host` half of the check in favour of an explicit allowlist.

- [ ] **TD-24 · The `Secure` cookie flag is decided by a client-controlled header** — Severity: Medium
  - **Why here:** `secure: !isLocalRequest(req)` inherits TD-23's forgeability, so a crafted `Host` gets the session cookie issued without `Secure` and it can then leak over plain HTTP. Separately, `serializeClearedCookie` never sets `Secure`, so logout downgrades too.
  - Where: [src/routes/auth.ts:58](src/routes/auth.ts:58), [src/routes/auth.ts:98](src/routes/auth.ts:98), [src/auth/cookies.ts:68](src/auth/cookies.ts:68)

## Group I — Query performance

*File: [src/db.ts](src/db.ts)*

- [ ] **TD-22 · No composite index `(merchant_id, created_at)`** — Severity: Medium
  - **Why here:** every list, export and range query filters by merchant and orders by date, and neither single-column index serves both.
  - **Verified with `EXPLAIN QUERY PLAN` on a 50 000-row database:** the orders list, the metrics summary, top-customers and the export all report `USE TEMP B-TREE FOR ORDER BY` — SQLite sorts in memory before returning anything. For the export that means the whole result is sorted *before* the first streamed row, which undercuts the "lazy" streaming the docstring promises.
  - Where: [src/db.ts:33](src/db.ts:33)

## Group D — Output escaping in the dashboard

*File: [public/app.js](public/app.js)*

- [ ] **TD-12 · Stored XSS in the orders table** — Severity: High
  - **Why here:** the dashboard executes attacker-controlled markup, and the payload is planted through `POST /api/orders` (TD-11).
  - **Why it ships after C:** C stops new payloads from being stored; D makes rendering safe regardless of what's already in the database. Both are needed — C alone doesn't clean existing rows.
  - Where: [public/app.js:63](public/app.js:63)
  - What happens: each row is built with `innerHTML`, interpolating `o.customer_email` and `o.type` unsanitized. (The file was rewritten for the session flow in plan 005; this line was left as-is on purpose so the fix is its own reviewable change.)

---

# Resolved

- [x] **TD-05 · Revenue counts refunds as income** — Severity: High
  - Resolved by [plan 006](plans/006-refund-semantics-in-money-math.md): refund semantics now live in `src/dal/money.ts`, and `/api/revenue` returns net revenue plus the gross and refunded amounts it is made of. Measured effect on the seeded data: `m_acme` went from 424 364 to 327 108 (−29.7 %) and `m_bistro` from 417 659 to 350 321 (−19.2 %) — a refund used to *add* its amount, so the error was about twice the refunded volume.
  - Gate: `test/architecture.test.ts` fails if `total_amount` is aggregated outside `src/dal/` (verified by temporarily adding such a line). Behavior pinned by `test/money.test.ts`, including negative net and the sale-plus-refund cancellation.
  - Also closed with it: **TD-06** (summary metrics treating refunds as sales), now `sales_orders` / `refund_orders` with both average figures.
  - Carried forward: **TD-18** — a refund still can't be matched to the sale it reverses.

- [x] **TD-01 · The `X-Merchant-Id` header is not verified** — Severity: High
  - Resolved by [plan 005](plans/005-jwt-auth-and-scoped-repositories.md): sessions are HS256 JWTs in HttpOnly cookies. Data access requires a merchant-scoped token whose `merchantId` claim the backend signs; a client-sent `X-Merchant-Id` is only compared, never used, and a mismatch is `403 merchant_mismatch`. Merchant switching goes through `POST /api/auth/token`, guarded by an admin token that cannot read data.
  - Caveat carried forward: `devAdminSession` hands an admin cookie to loopback requests for local development. Gated on the TCP peer address and disabled with `DEV_ADMIN_SESSION=off`; it must never run on a deployed instance.

- [x] **TD-02 · `GET /api/orders/:id` does not filter by merchant** — Severity: High
  - Resolved by [plan 005](plans/005-jwt-auth-and-scoped-repositories.md): `OrdersRepository.getById` goes through `BaseRepository`, which injects the merchant filter, so another merchant's order returns `404`. Covered by `test/base-repository.test.ts` and `test/auth-guard.test.ts`.

- [x] **TD-04 · `metrics.ts` bypasses the DAL** — Severity: Medium
  - Resolved by [plan 005](plans/005-jwt-auth-and-scoped-repositories.md): metrics queries moved into `MetricsRepository`, and the second read-only SQLite connection is gone. `test/architecture.test.ts` fails if any module other than `base-repository.ts` imports the database handle, so the bypass can't come back quietly.
