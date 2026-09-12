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
| **C — Input validation at the API edge** | TD-10, TD-11 | `routes/orders.ts`, `routes/metrics.ts` | ⬜ Open |
| **D — Output escaping in the dashboard** | TD-12 | `public/app.js` | ⬜ Open |
| **E — Refund semantics in money math** | TD-05 | `dal/`, `routes/revenue.ts`, `routes/metrics.ts` | ✅ Done — [plan 006](plans/006-refund-semantics-in-money-math.md) |

Suggested order for what's left: **C → D**. C stops new payloads from being stored; D makes rendering safe regardless of what's already in the database.

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
