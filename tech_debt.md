# Tech debt

Findings from reviewing the current architecture. None of these are resolved yet:
each item will be documented, prioritized, or discarded one at a time.

Rough severity: **High** (security / wrong data), **Medium** (robustness / design), **Low** (hygiene).

---

## Authentication and merchant isolation

- [ ] **TD-01 · The `X-Merchant-Id` header is not verified** — High
  - Where: [src/auth.ts:16](src/auth.ts:16), [public/app.js:9](public/app.js:9)
  - What happens: `authMiddleware` only checks that the header is present and copies it to `req.merchantId`. Any client can impersonate any merchant by changing the value.
  - Note: documented as an intentional simplification for the challenge ("Real auth would be a signed JWT").

- [ ] **TD-02 · `GET /api/orders/:id` does not filter by merchant** — High
  - Where: [src/routes/orders.ts:16](src/routes/orders.ts:16), [src/dal/orders-dal.ts:38](src/dal/orders-dal.ts:38)
  - What happens: `ordersDal.getById(id)` looks up by `id` only and ignores `req.merchantId`. A merchant can read another merchant's orders if they know the id.

- [ ] **TD-03 · `POST /api/orders` with a non-existent merchant returns 500** — Medium
  - Where: [src/routes/orders.ts:35](src/routes/orders.ts:35)
  - What happens: since auth accepts any value, a `merchantId` that doesn't exist violates the `orders.merchant_id → merchants.id` FK (`foreign_keys = ON`). The exception reaches the generic error handler and returns `500 internal_error` instead of a 4xx.

## Data access layer

- [ ] **TD-04 · `metrics.ts` bypasses the DAL** — Medium
  - Where: [src/routes/metrics.ts:5](src/routes/metrics.ts:5)
  - What happens: it opens its own `new Database(DB_PATH, { readonly: true })` connection and runs raw SQL. According to [docs/architecture.md](docs/architecture.md), all order queries should go through `ordersDal`. Any tenancy filter, auditing, or caching added to the DAL won't apply to metrics.
  - Side effect: there are two connections to the same database (one in `db.ts`, one here), and `DB_PATH` is resolved twice.

## Calculation correctness (refunds)

- [ ] **TD-05 · Revenue counts refunds as income** — High
  - Where: [src/dal/orders-dal.ts:54](src/dal/orders-dal.ts:54)
  - What happens: `sumAmountByMerchant` runs `SUM(total_amount)` without looking at `type`. Refunds are stored with a positive amount (see [src/scripts/seed.ts:43](src/scripts/seed.ts:43)), so they add to revenue instead of subtracting. According to [docs/architecture.md](docs/architecture.md), a refund represents a reversed sale.

- [ ] **TD-06 · Summary metrics treat refunds as sales** — Medium
  - Where: [src/routes/metrics.ts:17](src/routes/metrics.ts:17), [src/routes/metrics.ts:45](src/routes/metrics.ts:45)
  - What happens: `total_orders`, `unique_customers`, `avg_order_value_cents`, and `top-customers.total_spent` count every row the same way, without distinguishing `sale` from `refund`.

## Dates

- [ ] **TD-07 · The revenue range excludes the `to` day, so the dashboard leaves out today** — Medium
  - Where: [src/dal/orders-dal.ts:59](src/dal/orders-dal.ts:59), [public/app.js:28](public/app.js:28)
  - What happens: the filter is `created_at < to` and `to` is a `YYYY-MM-DD` date, so the whole `to` day is excluded. The frontend sends `to = today`, so "Revenue (last 30 days)" doesn't include today's orders.

- [ ] **TD-08 · `created_at` is stored in mixed formats** — Medium
  - Where: [src/db.ts:30](src/db.ts:30), [src/scripts/seed.ts:21](src/scripts/seed.ts:21)
  - What happens: the seed stores ISO 8601 (`2026-09-10T12:00:00.000Z`), while orders created via `POST` use SQLite's `DEFAULT CURRENT_TIMESTAMP` (`2026-09-10 12:00:00`). Comparisons and `ORDER BY` are string-based, so ordering within the same day can be wrong. The browser also parses the format without `T`/`Z` as local time.

- [ ] **TD-09 · `from`/`to` are not validated** — Low
  - Where: [src/routes/revenue.ts:12](src/routes/revenue.ts:12), [src/routes/orders.ts:9](src/routes/orders.ts:9)
  - What happens: any string is accepted as a date and compared lexicographically. In `GET /api/orders`, if only one of the two parameters is sent, the filter is silently ignored.

## Input validation

- [ ] **TD-10 · `limit` is not validated** — Medium
  - Where: [src/routes/orders.ts:11](src/routes/orders.ts:11), [src/routes/metrics.ts:43](src/routes/metrics.ts:43)
  - What happens: `Number(req.query.limit)` can yield `NaN`, a decimal, or a negative number. In SQLite, `LIMIT -1` means "no limit", so `?limit=-1` returns all of the merchant's orders. There is no upper bound.

- [ ] **TD-11 · The `POST /api/orders` body is barely validated** — Medium
  - Where: [src/routes/orders.ts:25](src/routes/orders.ts:25)
  - What happens: `type` accepts any string (not just `sale`/`refund`), `total_amount` accepts negatives and decimals even though the column holds integer cents, and `customer_email` is not validated as an email.

## Frontend

- [ ] **TD-12 · Stored XSS in the orders table** — High
  - Where: [public/app.js:35](public/app.js:35)
  - What happens: each row is built with `innerHTML` interpolating `o.customer_email` and `o.type`, which come unsanitized from `POST /api/orders` (see TD-11). An order with HTML/JS in those fields executes in the dashboard of whoever views it.

- [ ] **TD-13 · The frontend doesn't handle API errors** — Low
  - Where: [public/app.js:8](public/app.js:8)
  - What happens: `api()` doesn't check `r.ok`. A 401/500 is parsed as if it were a valid response, and the fields end up showing `—` or `$0.00` with no warning.

- [ ] **TD-14 · The merchant list is hardcoded in the HTML** — Low
  - Where: [public/index.html:28](public/index.html:28)
  - What happens: the selector's merchants duplicate [src/scripts/seed.ts:4](src/scripts/seed.ts:4) and don't come from the API.

## Tooling, tests, and documentation

- [ ] **TD-15 · `npm run seed` probably does nothing on Windows** — Low
  - Where: [src/scripts/seed.ts:60](src/scripts/seed.ts:60)
  - What happens: the `isMain` check compares `import.meta.url` (`file:///C:/...`, with `/`) against `process.argv[1]` (`C:\...`, with `\`), so neither condition matches. In practice this is masked because the server calls `seedIfEmpty()` on startup.

- [ ] **TD-16 · Test coverage is minimal** — Medium
  - Where: [test/orders.test.ts](test/orders.test.ts)
  - What happens: only the DAL's `create`, `listByMerchant`, and `getById` are tested. There are no tests for routes, auth, revenue, or metrics, which is where most of the items above live.

- [ ] **TD-17 · `docs/architecture.md` is outdated** — Low
  - Where: [docs/architecture.md](docs/architecture.md)
  - What happens: it mentions a `lib/` folder that doesn't exist and labels itself as an unmaintained draft.
