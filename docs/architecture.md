# Architecture

A small merchant sales dashboard: static frontend, Express API, SQLite database.

Endpoint details are in [api.md](api.md); branch and release rules in [github-workflow.md](github-workflow.md).

## Request flow

```
browser (public/)
  │  fetch with HttpOnly cookies
  ▼
express (src/app.ts)
  ├─ devAdminSession      local requests only: hands out an admin cookie
  ├─ express.static       serves public/
  ├─ /api/auth            session endpoints (mint, exchange, whoami, logout)
  ├─ /api/merchants       admin-scoped
  └─ /api/orders|revenue|metrics
        │  requireAuth() verifies the token and opens the auth context
        ▼
     routes → repositories (src/dal) → SQLite (src/db.ts)
```

## Modules

| Path | Role |
|---|---|
| `src/server.ts` | Entry point: schema init, seed, listen. |
| `src/app.ts` | Express wiring. `createApp()` is exported so tests can bind an ephemeral port. |
| `src/config/env.ts` | The only reader of configuration. Loads `.env` with Node's built-in `process.loadEnvFile()`. |
| `src/auth/jwt.ts` | Signs and verifies session tokens (`jose`, HS256). |
| `src/auth/guard.ts` | `requireAuth({ scope })` — the middleware that protects routes. |
| `src/auth/context.ts` | Per-request identity in an `AsyncLocalStorage`. |
| `src/auth/local.ts` | Loopback detection for the development bootstrap. |
| `src/auth/dev-session.ts` | Issues the admin cookie to local requests (dev only). |
| `src/auth/cookies.ts` | Cookie parsing/serialization (no dependency). |
| `src/dal/base-repository.ts` | `BaseRepository` / `AdminRepository`. **The only module that touches the database handle.** |
| `src/dal/money.ts` | The SQL expressions that define revenue. **The only place refund semantics live.** |
| `src/dal/*-repository.ts` | One repository per entity. |
| `src/routes/*.ts` | Express routers, one file per resource. |
| `src/scripts/` | CLI entry points: `seed`, `issue-token`, `setup-env`, `check-deps`. |
| `public/` | Static dashboard (plain HTML + `fetch`, no framework). |

## Authentication

Two HS256 JWTs in HttpOnly cookies:

- **Admin token** (`scope: mint`, 8h) — mints merchant tokens and lists merchants. It cannot read data.
- **Merchant token** (`scope: data`, 10m) — reads only the merchant named in its `merchantId` claim.

The design rule is one line: **the merchant id always comes from a token the backend signed.** A client-sent `X-Merchant-Id` is only compared against the token, never used; a mismatch is `403`. Switching merchants in the dashboard means asking the backend for a new token, not sending a different header.

`requireAuth()` verifies the cookie, then runs the rest of the request inside an `AsyncLocalStorage` context. Any class or function reached during the request can call `getAuthContext()` — no parameter threading — and the call **throws** if no context exists, so code can't accidentally run unauthenticated.

### Development bootstrap, and its limit

`devAdminSession` hands an admin cookie to requests whose **TCP peer address is loopback** (a spoofed `Host: localhost` from elsewhere does not qualify), so `npm run dev` works without a login step. `DEV_ADMIN_SESSION=off` disables it.

This is a convenience, not a login. On a deployed instance it would give every visitor a credential that can mint any merchant's token. A real deployment needs an actual login issuing the admin token, and this middleware removed.

## Data access

Every order query goes through a repository. `BaseRepository` reads the merchant id from the auth context and injects it into each `SELECT` and `INSERT`; subclasses never see the connection and never pass a merchant id, so a repository *cannot* forget the tenancy filter. `AdminRepository` covers `merchants` — the tenant list itself, which isn't merchant-scoped — and requires an admin caller instead.

`test/architecture.test.ts` enforces the rule: if any module other than `base-repository.ts` imports the `db` handle, the suite fails. Standalone scripts are exempt.

## Data model

Two tables, `merchants` and `orders`; canonical DDL in `src/db.ts`.

`orders.type` is `'sale' | 'refund'`. A refund row records that a sale was reversed and stores a **positive** `total_amount` like any other row; it does not modify the sale row.

## Money

Because refunds are stored positive, summing `total_amount` counts a refund as income — the amount is added instead of subtracted, so the error is about twice the refunded volume. All money figures are therefore derived from the named expressions in `src/dal/money.ts`:

| Expression | Meaning |
|---|---|
| `NET_AMOUNT` | Sales add, refunds subtract → net revenue |
| `SALES_ONLY` / `REFUNDS_ONLY` | The two halves, so a net figure can be explained |
| `SALE_COUNT` / `REFUND_COUNT` | Orders placed vs refunds issued, never mixed |

Net revenue can be negative for a period dominated by refunds; nothing clamps it. `test/architecture.test.ts` fails the build if `total_amount` is aggregated outside `src/dal/`, so a new endpoint can't quietly reintroduce the bug.

Two limits worth knowing: refunds cannot be matched to the sale they reverse (no link column — TD-18), so netting is exact in total but can't answer "was *this* sale refunded"; and `status` is not filtered, because every row is `completed` today. If other statuses appear, money math must exclude the non-completed ones.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | generated | Missing on a local start → generated and appended to `.env` so server and CLI share it. |
| `PORT` | `3000` | |
| `DB_PATH` | `data/dashboard.db` | `:memory:` in tests. |
| `ADMIN_TOKEN_TTL` | `8h` | |
| `MERCHANT_TOKEN_TTL` | `10m` | |
| `DEV_ADMIN_SESSION` | `on` | `off` disables the local admin cookie. |

`npm run setup:env` creates `.env` from `.env.example`; it never overwrites an existing value.

## Known gaps

Tracked in `tech_debt.md` (active) and `tech_debt_backlog.md` (deferred). The ones visible from this document: unvalidated `limit` and request bodies (TD-10, TD-11), stored XSS in the dashboard table (TD-12), no refund→sale link (TD-18), and the exclusive `to` bound in date ranges (TD-07).
