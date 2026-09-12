# API reference

Base URL: `http://localhost:3000` (or `PORT`). All responses are JSON.

Authentication and the branch/release process are described in [github-workflow.md](github-workflow.md) and [architecture.md](architecture.md).

## Authentication

Two token types, both HS256 JWTs signed by the backend and delivered as **HttpOnly** cookies (`SameSite=Strict`, `Secure` on non-local requests). Nothing is stored in `localStorage`.

| Token | Cookie | Claims | TTL | Can do |
|---|---|---|---|---|
| Admin | `admin_session` | `role: admin`, `scope: mint` | `ADMIN_TOKEN_TTL` (8h) | Mint merchant tokens, list merchants |
| Merchant | `merchant_session` | `role: merchant`, `scope: data`, `merchantId` | `MERCHANT_TOKEN_TTL` (10m) | Read that merchant's data |

Rules enforced by the guard:

- **The token decides the merchant.** `X-Merchant-Id` is never used to select data; if it is sent and differs from the token's merchant, the request is rejected with `403 merchant_mismatch`.
- **The admin token cannot read data** (`403 token_not_scoped_for_data`), and a merchant token cannot mint (`403 token_not_scoped_for_mint`). One rule, no exceptions: data always comes from a merchant-scoped token.
- Merchant tokens are short-lived. When one expires the API answers `401 session_expired`; the client mints a new one and retries.

### Getting a session

**Locally**, the server hands an `admin_session` cookie to any request coming from loopback, so opening the dashboard is enough. This is a development convenience: it is gated on the TCP peer address (a spoofed `Host: localhost` from another machine does not pass) and can be disabled with `DEV_ADMIN_SESSION=off`. **It must never be enabled on a deployed instance** — it would hand a minting credential to every visitor.

**Otherwise**, mint an admin token from the CLI and exchange it for the cookie:

```sh
npm run token                    # prints an admin token (add expiresIn=30m to shorten it)
curl -i -X POST http://localhost:3000/api/auth/admin-session \
  -H "Content-Type: application/json" -d '{"token":"<token>"}'
```

## Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `merchant_id_required`, `token_required`, `invalid_body`, `missing_date_range` | Malformed request |
| 401 | `unauthenticated` | No session cookie |
| 401 | `session_expired` | Token invalid, expired, or signed with another key |
| 403 | `merchant_mismatch` | `X-Merchant-Id` differs from the token's merchant |
| 403 | `token_not_scoped_for_data` / `token_not_scoped_for_mint` | Right session, wrong token type |
| 404 | `not_found`, `merchant_not_found` | Unknown id — including another merchant's order |
| 500 | `internal_error` | Unhandled server error |

---

## Auth endpoints

### `POST /api/auth/token`
Mints a merchant session. **Requires the admin token** (cookie or `Authorization: Bearer`).

Body: `{ "merchantId": "m_acme" }` → `204` with `Set-Cookie: merchant_session`.
Errors: `400 merchant_id_required`, `404 merchant_not_found`.

### `POST /api/auth/admin-session`
Exchanges an admin token for the `admin_session` cookie. Body: `{ "token": "<jwt>" }` → `204`.

### `GET /api/auth/session`
Describes the current session: `{ role, scope, merchantId, expiresAt }`. `401` when there is none.

### `DELETE /api/auth/session`
Clears both cookies. `204`.

## Data endpoints

All of these require a **merchant** session.

### `GET /api/health`
No auth. `{ ok: true }`.

### `GET /api/merchants`
Every merchant: `{ merchants: [{ id, name }] }`. **Requires the admin token** — a merchant session is bound to one merchant and gets `403`.

### `GET /api/orders`
Orders of the session's merchant, newest first.

Query: `from`, `to` (`YYYY-MM-DD`, applied only when both are present; `to` is exclusive), `limit` (default 100).

```json
{ "orders": [{ "id": "…", "merchant_id": "m_acme", "customer_email": "ana@example.com",
               "total_amount": 11136, "type": "sale", "status": "completed",
               "created_at": "2026-09-11T11:45:35.866Z" }] }
```

> `limit` is not validated yet — see TD-10 in `tech_debt.md`.

### `GET /api/orders/:id`
One order: `{ order }`. An order belonging to another merchant returns `404 not_found`, not the row.

### `POST /api/orders`
Creates an order for the session's merchant. The merchant is taken from the token, never from the body.

Body: `{ customer_email, total_amount, type? }` — `total_amount` in integer cents, `type` is `sale` (default) or `refund`. Returns `201` with `{ order }`.

> Body validation is still thin — see TD-11 in `tech_debt.md`.

### `GET /api/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD`
Both parameters are required.

```json
{ "merchant_id": "m_acme", "from": "2026-08-01", "to": "2026-09-12",
  "revenue_cents": 238200, "revenue": 2382 }
```

> Refunds are currently summed as income, and `to` is exclusive so "today" is excluded — see TD-05 and TD-07 in `tech_debt.md`.

### `GET /api/metrics/summary`

```json
{ "merchant_id": "m_acme", "total_orders": 40,
  "unique_customers": 3, "avg_order_value_cents": 10609 }
```

| Field | Meaning |
|---|---|
| `total_orders` | Rows in `orders` for the merchant (refunds included — TD-06) |
| `unique_customers` | Distinct `customer_email` values |
| `avg_order_value_cents` | Rounded average of `total_amount` |

### `GET /api/metrics/top-customers`
Query: `limit` (default 5).

```json
{ "customers": [{ "customer_email": "ana@example.com", "order_count": 14, "total_spent": 181968 }] }
```
