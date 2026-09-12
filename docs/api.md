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
  "revenue_cents": 327108, "revenue": 3271.08,
  "gross_sales_cents": 375736, "refunds_cents": 48628 }
```

| Field | Meaning |
|---|---|
| `revenue_cents` | **Net**: gross sales minus refunds. Can be negative when refunds exceed sales in the period — that is a real state, not an error |
| `revenue` | The same figure in currency units |
| `gross_sales_cents` | Sales only |
| `refunds_cents` | Refunds only, as a positive number |

`gross_sales_cents - refunds_cents === revenue_cents` always holds, so a drop in revenue can be attributed to falling sales or rising refunds without another call.

> `to` is exclusive, so orders placed on the `to` date are not counted — see TD-07 in `tech_debt_backlog.md`.

### `GET /api/metrics/summary`

```json
{ "merchant_id": "m_acme", "sales_orders": 34, "refund_orders": 6,
  "unique_customers": 3,
  "avg_order_value_cents": 11051, "avg_net_order_value_cents": 9621 }
```

| Field | Meaning |
|---|---|
| `sales_orders` | Orders placed (rows of type `sale`) |
| `refund_orders` | Refund rows — reported separately, never folded into the order count |
| `unique_customers` | Distinct customers with **at least one sale** |
| `avg_order_value_cents` | Average amount of a sale: what a typical order looks like |
| `avg_net_order_value_cents` | Net revenue ÷ number of sales: what a sale is worth after refunds |

There is no `total_orders` field: counting a refund as an order is what made the old number misleading. Add `sales_orders` and `refund_orders` if you need the raw row count.

### `GET /api/metrics/top-customers`
Query: `limit` (default 5).

```json
{ "customers": [{ "customer_email": "ana@example.com", "order_count": 14, "total_spent": 181968 }] }
```

`total_spent` is **net** (sales minus refunds) and `order_count` counts sales only, so a customer who refunded more than they bought shows a negative total and ranks last.
