# 005 — JWT auth (HttpOnly cookies, admin-minted merchant tokens) + scoped repository base class

**Status:** done (2026-09-11, rev 3) — implemented, validated locally, `docs/` updated (also closes TD-17)

Closes Tier 1 groups **A** (TD-02, TD-04) and **B** (TD-01) from [tech_debt.md](../tech_debt.md).

## Context

Today `authMiddleware` trusts an `X-Merchant-Id` header, `ordersDal.getById` ignores the merchant entirely, and `metrics.ts` queries SQLite through its own connection, bypassing the DAL. Any client can read any merchant's data, and a tenancy filter added to the DAL wouldn't cover the metrics endpoints.

The challenge also requires being able to **look at both seeded merchants** from the dashboard, so the design needs a legitimate way to switch merchants without trusting a client-sent id.

### Token model

- An **admin token** is a *minting* credential. It is injected into an HttpOnly cookie on a local request (dev), and it mints merchant-scoped tokens.
- Every time the **merchant selector changes**, the frontend asks the auth endpoint for a **new merchant token** for that merchant.
- Merchant tokens are **short-lived**; the admin token acts like a refresh token.

All data access therefore goes through a token whose `merchantId` claim is fixed by the backend.

### Security boundary (explicit, because it's the risky part)

Auto-injecting an admin cookie means *whoever gets it can mint any merchant's token*. Acceptable as a local dev convenience, unacceptable when exposed. Therefore the auto-injection is gated on the request being **local**, and the gate does **not** trust the `Host` header:

```ts
isLocalRequest(req) =
  isLoopback(req.socket.remoteAddress)        // 127.0.0.1, ::1, ::ffff:127.0.0.1 — from the TCP connection
  && hostnameOf(req.headers.host) in {localhost, 127.0.0.1, [::1]}
```

- The **connection address** is the real gate: a remote attacker sending `Host: localhost` still fails, because their packets don't come from loopback. The host check is a secondary guard for local-but-unexpected origins.
- `X-Forwarded-For` / `X-Forwarded-Host` are deliberately **ignored** (a proxy could forge them).
- Every server start logs: `⚠ local dev: auto-issuing admin session cookies for loopback requests`.
- Documented in `docs/`: deploying this behind a proxy that terminates on loopback would reopen TD-01.

## Decision

### 0. Configuration and `.env`

New module **`src/config/env.ts`** — the single place that reads configuration:

```ts
loadEnv();                      // process.loadEnvFile('.env') when the file exists (no-op otherwise)
export const config = {
  port, dbPath, jwtSecret,
  adminTokenTtl, merchantTokenTtl,
};
```

- **Loader:** Node's built-in `process.loadEnvFile()` (available in this Node; verified on v24). No `dotenv` dependency — see Q6.
- **`.env.example`** is committed with every variable documented; **`.env`** is already covered by `.gitignore` and never committed.

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | — | Required. See the rule below. |
| `PORT` | `3000` | Existing behavior. |
| `DB_PATH` | `data/dashboard.db` | Existing behavior. |
| `ADMIN_TOKEN_TTL` | `8h` | |
| `MERCHANT_TOKEN_TTL` | `10m` | |

**`JWT_SECRET` rule:**

1. If set (env or `.env`) → use it.
2. If missing and the process is being started for local development → **generate a random secret, write it to `.env`, and warn**. This persists it, so `npm run token` (a separate process) signs with the same secret.
3. If missing and `.env` can't be written → **fail fast at startup** with a message pointing to `npm run setup:env`.

New script `"setup:env": "tsx src/scripts/setup-env.ts"` creates `.env` from `.env.example` with a freshly generated `JWT_SECRET`, and is idempotent (never overwrites an existing value).

### 1. Dependencies

| Choice | Why |
|---|---|
| **`jose@^6.2.12`** for JWT (new prod dependency) | MIT, **zero transitive dependencies**, native ESM, typed. `jsonwebtoken@9` pulls 10 packages; hand-rolled HS256 rejected on an auth boundary. |
| **No `dotenv`** | `process.loadEnvFile()` is built in. |
| **No cookie library** | `cookie@2` needs Node ≥22 (project declares `>=20`), `cookie-parser` is a dependency for ~15 lines, and the JWT is signed so cookie integrity isn't needed. A small `parseCookies()` helper suffices. |

### 2. Two token types

| | Admin token | Merchant token |
|---|---|---|
| Claims | `role: 'admin'`, `scope: 'mint'`, `sub: 'admin'` | `role: 'merchant'`, `scope: 'data'`, `merchantId`, `sub: <merchantId>` |
| TTL | `ADMIN_TOKEN_TTL` (8h) | `MERCHANT_TOKEN_TTL` (10m) |
| Cookie | `admin_session` (HttpOnly) | `merchant_session` (HttpOnly) |
| Can read data? | ❌ `403 token_not_scoped_for_data` | ✅ its own merchant only |
| Can mint tokens? | ✅ | ❌ |

Both: HS256, `iss: recruiting-challenge`, `iat`, `exp`.

Cookie attributes: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age` = TTL, and `Secure` **unless the request is local** (so `http://localhost` works in dev and anything else gets `Secure`).

**Why the admin token can't read data (Q3):** it keeps one rule for every data query — *the merchantId comes from the token, never from the client*. Otherwise the admin path reintroduces "trust the client's `X-Merchant-Id`", which is TD-01.

### 3. Endpoints — `src/routes/auth.ts`

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /api/auth/token` | `admin_session` cookie (or `Authorization: Bearer <admin token>`) | Body `{ merchantId }`. Verifies the merchant exists, mints a short-lived merchant token, replies `204` + `Set-Cookie: merchant_session`. Called on every selector change. |
| `GET /api/auth/session` | any cookie | `{ role, merchantId, expiresAt }` so the UI knows what to render. |
| `DELETE /api/auth/session` | — | Clears both cookies. |
| `POST /api/auth/admin-session` | — | Exchanges an admin token (body `{ token }`, from `npm run token`) for the `admin_session` cookie. The non-local way in. |

### 4. Dev bootstrap

Middleware `devAdminSession`: when `isLocalRequest(req)` and there's no `admin_session` cookie, mint one and set it on the response. Non-local requests are untouched and hit the normal `401`.

### 5. Script — `src/scripts/issue-token.ts`

Mints **admin** tokens (merchant tokens come from the endpoint):

```sh
npm run token                 # admin token, ADMIN_TOKEN_TTL
npm run token -- expiresIn=30m
```

Prints the token plus a `curl` example for `POST /api/auth/admin-session`. `package.json`: `"token": "tsx src/scripts/issue-token.ts"`.

### 6. Auth layer

```
merchant_session cookie ──▶ verifyToken ──▶ AuthContext (AsyncLocalStorage) ──▶ guard ──▶ route ──▶ repository
```

- **`src/auth/jwt.ts`** — `signToken(claims, expiresIn)` / `verifyToken(token)` (jose, HS256, issuer + scope checks).
- **`src/auth/context.ts`** — `AsyncLocalStorage<AuthContext>` with `runWithAuthContext(ctx, fn)` and `getAuthContext()`. This is what makes the layer **injectable in any class or method** without threading parameters; it **throws** when there's no context (fail closed).
- **`src/auth/local.ts`** — `isLocalRequest(req)` as defined above; used by the dev bootstrap and by the cookie's `Secure` flag.
- **`src/auth/guard.ts`** — `requireAuth({ scope })`, usable per-router or per-route:
  ```ts
  app.use('/api/orders', requireAuth(), ordersRouter);              // data-scoped token
  app.post('/api/auth/token', requireAuth({ scope: 'mint' }), …);   // admin token
  ```
- `src/auth.ts` is deleted; `server.ts` wires the guard.

**Rules enforced by the guard:**

| Situation | Result |
|---|---|
| No token | `401 unauthenticated` |
| Expired / invalid / wrong issuer | `401 session_expired` |
| Admin token on a data route | `403 token_not_scoped_for_data` |
| Merchant token on a mint route | `403 token_not_scoped_for_mint` |
| Client sends `X-Merchant-Id` ≠ token's | `403 merchant_mismatch` |
| Client sends `X-Merchant-Id` = token's | allowed (ignored; the token wins) |

The client-sent merchantId is never *used*, only compared.

### 7. Repository base class — `src/dal/base-repository.ts`

```ts
abstract class BaseRepository<TRow> {
  protected abstract readonly table: string;
  protected abstract readonly merchantColumn: string;  // 'merchant_id'
  protected scope(): string        // merchantId from the auth context; throws if absent
  protected select(sql, params)    // injects `AND <merchantColumn> = ?`
  protected insert(row)            // forces merchantColumn = scope()
}
```

- The merchant filter is **not** a parameter a subclass can forget: the base class reads it from `getAuthContext()`.
- `OrdersRepository` (replaces `ordersDal`) and `MetricsRepository` (replaces the raw SQL in `metrics.ts`, dropping its second read-only connection) extend it. **TD-04 closed.**
- `getById` becomes merchant-scoped. **TD-02 closed.**

**Enforcement gate:** `test/architecture.test.ts` asserts that **only `src/dal/base-repository.ts` imports `db` from `src/db.ts`** (`src/scripts/*` excluded), so a new repository that reaches for `db` fails the suite.

### 8. Dashboard (`public/index.html`, `public/app.js`)

- Cookies travel automatically (same origin); no `X-Merchant-Id` header, no `localStorage`.
- On load: `GET /api/auth/session`. On selector change: `POST /api/auth/token { merchantId }`, then reload the data.
- On `401 session_expired`: re-mint once with the current selection and retry; if it fails again, show "session expired".
- The merchant list comes from a new `GET /api/merchants` (mint-scoped) instead of being hardcoded — closes TD-14 on the way.

### 9. Commits (in order)

| # | Content | Tech debt |
|---|---|---|
| 1 | `src/config/env.ts`, `.env.example`, `setup:env`, `.gitignore` check | — |
| 2 | `jose` + `src/auth/jwt.ts` + `src/scripts/issue-token.ts` + `npm run token` + tests | — |
| 3 | `context.ts` + `local.ts` + `guard.ts` + cookies helper + `src/routes/auth.ts` + dev bootstrap + `server.ts` wiring; `src/auth.ts` removed | TD-01 |
| 4 | `base-repository.ts` + `OrdersRepository` + architecture test | TD-02 |
| 5 | `MetricsRepository`; `metrics.ts` no longer touches `db`/SQLite | TD-04 |
| 6 | Dashboard: session bootstrap, selector minting, 401 re-mint, `/api/merchants` | TD-01 (UI), TD-14 |

## Open questions

- **Q1 — `jose` as a new prod dependency?** Recommended (zero transitive deps). Alternative: hand-rolled HS256 with `node:crypto`.
- **Q3 — Admin token is mint-only** (can't read data). Recommended, see §2.
- **Q4 — TTLs:** admin 8h, merchant 10m, both configurable in `.env`.
- **Q5 — Expiry handling.** Recommended: `401 session_expired` + frontend re-mints once. Alternative: keep the last merchantId in the admin cookie for a transparent server-side refresh.
- **Q6 — `.env` loader.** Recommended: Node's built-in `process.loadEnvFile()` (zero dependencies; confirmed available on Node 24 here). Alternative: the `dotenv@17` package, if you prefer the conventional setup — it's one more prod dependency for the same result.
- **Q7 — Auto-generating `JWT_SECRET` into `.env` on first local start.** Recommended (dev never has to think about it, and the CLI shares the secret). Alternative: always fail with "run `npm run setup:env`".

*(Q2 from rev 2 is folded into §0.)*

## Scope

- New: `src/config/env.ts`, `src/auth/jwt.ts`, `src/auth/context.ts`, `src/auth/guard.ts`, `src/auth/cookies.ts`, `src/auth/local.ts`, `src/auth/dev-session.ts`, `src/routes/auth.ts`, `src/routes/merchants.ts`, `src/dal/base-repository.ts`, `src/dal/orders-repository.ts`, `src/dal/metrics-repository.ts`, `src/scripts/issue-token.ts`, `src/scripts/setup-env.ts`, `.env.example`.
- Changed: `src/server.ts`, `src/db.ts` (reads `config`), `src/routes/orders.ts`, `src/routes/revenue.ts`, `src/routes/metrics.ts`, `public/index.html`, `public/app.js`, `package.json`, `test/orders.test.ts`.
- Removed: `src/auth.ts`, `src/dal/orders-dal.ts`.
- Tests: `test/env.test.ts`, `test/auth-jwt.test.ts`, `test/auth-guard.test.ts`, `test/auth-local.test.ts`, `test/base-repository.test.ts`, `test/architecture.test.ts`, updated `test/orders.test.ts`.

## Out of scope

- Refund math (TD-05), input validation (TD-10, TD-11), XSS escaping (TD-12) — groups C, D, E.
- Real login (credentials, user table), token revocation, admin-token rotation.
- Rate limiting; CSRF tokens (mitigated by `SameSite=Strict`).
- `docs/` — authorization to be requested after validation (CLAUDE.md §6): `docs/api.md` (auth endpoints, token types, the local-only caveat), `docs/architecture.md` (auth layer + repository base class, closing TD-17), and a `.env` section in the README setup (needs your explicit go, README is not normally touched).

## Validation

1. `npm test` → new + existing tests pass.
2. `tsc --noEmit` → exit 0.
3. `npm run check:deps` → no new advisories from `jose`.
4. `.env`: with no `.env`, a local start creates it with a random `JWT_SECRET` and warns; re-running doesn't overwrite it; `npm run token` signs with the same secret (the token verifies against the running server).
5. `npm run token` → claims decode to `role: admin`, `scope: mint`, no `merchantId`.
6. Guard, by `curl`:
   - no cookie → `401`;
   - admin cookie on `/api/orders` → `403 token_not_scoped_for_data`;
   - merchant cookie → `200` with its own data;
   - merchant cookie + another merchant's `X-Merchant-Id` → `403 merchant_mismatch`;
   - merchant token with `expiresIn=1s` → `401 session_expired`;
   - `POST /api/auth/token` without an admin cookie → `401`;
   - `POST /api/auth/token { merchantId: 'nope' }` → `404 merchant_not_found`.
7. TD-02: `GET /api/orders/:id` with another merchant's order id → `404`.
8. TD-04: no `better-sqlite3` import under `src/routes/`; architecture test passes.
9. Local gating: request to `http://localhost:3000/` gets the admin cookie; the same request from a non-loopback address (or with `Host: localhost` spoofed from another machine, simulated in a unit test of `isLocalRequest`) does **not**.
10. Browser: the selector switches between `m_acme` and `m_bistro` (each change mints a token); after the merchant token expires the next action re-mints instead of failing; `document.cookie` exposes neither cookie.

## Rollback

Revert the commits; `src/auth.ts` and `src/dal/orders-dal.ts` return with them. Delete `.env` if it was generated. No database migration involved.

## Results

All open questions were approved as recommended (jose; mint-only admin token; 8h/10m TTLs; frontend-driven re-mint; native `loadEnvFile`; auto-generated secret).

| Step | Result |
|---|---|
| 1. `npm test` | ✅ 52/52 (37 new) |
| 2. `tsc --noEmit` | ✅ exit 0 |
| 3. `npm run check:deps` | ✅ `No known vulnerabilities` with `jose@6.2.12` |
| 4. `.env` | ✅ absent → `npm run token` created it with a random `JWT_SECRET`; a second run kept the same secret (server and CLI share it) |
| 5. `npm run token` | ✅ claims `{role: admin, scope: mint}`, no `merchantId`, 8h |
| 6. Guard (curl) | ✅ admin cookie on `/api/orders` → `403 token_not_scoped_for_data`; merchant cookie → own data; spoofed `X-Merchant-Id` → `403 merchant_mismatch`; own header → `200`; mint unknown merchant → `404`; expired token → `401 session_expired` (unit test) |
| 7. TD-02 | ✅ `GET /api/orders/bistro-1` with an `m_acme` session → `404` |
| 8. TD-04 | ✅ architecture test passes; no `better-sqlite3` under `src/routes/` |
| 9. Local gating | ✅ `DEV_ADMIN_SESSION=off` → no auto cookie and `/api/orders` → `401`; `isLocalRequest` unit tests cover a spoofed `Host` from a remote peer |
| 10. Browser | ✅ picker populated from `/api/merchants`; switching `m_acme` → `m_bistro` mints a new token and the numbers change; `document.cookie` is empty (HttpOnly); TTLs decoded from the jar: merchant 10.0 min, admin 480 min |

### Deviations from the plan

- **`src/app.ts` extracted from `src/server.ts`** (`createApp(options)`), so HTTP tests can bind an ephemeral port. Not in the original file list.
- **`src/routes/async-handler.ts`** added: Express 4 doesn't forward rejected promises, and the auth routes are async.
- **Guard reads the "wrong" cookie on purpose.** Presenting an admin token to a data route (or vice versa) now returns `403 token_not_scoped_for_*` instead of `401`; looking only at the expected cookie made a wrong-token request indistinguishable from no session.
- **Architecture test checks the imported binding, not the module.** `server.ts` legitimately imports `initSchema` from `db.ts`; only importing the `db` handle is an offense.
- **Validation step "no cookie → 401" reads `403` on a local request** with the dev bootstrap on, because the middleware attaches an admin cookie to that very request. The true `401` is verified with `DEV_ADMIN_SESSION=off`.

### Known gaps (by design, still open)

- **TD-12 (stored XSS)** is untouched: `public/app.js` still renders rows with `innerHTML`. It belongs to group D and was left out so the fix lands as its own reviewable change.
- **TD-10 / TD-11** (unvalidated `limit`, weak body validation) remain — group C.
