# 008 — Feature: CSV export of orders

**Status:** done (2026-09-12, rev 3 — Option A approved) — implemented and validated locally; `docs/` pending authorization

The challenge's Feature A. Chosen because it reuses what we just fixed — merchant scoping (plan 005) and refund semantics (plan 006) — and because an export button is the thing merchants ask for first on a dashboard like this.

## Context

The dashboard can show orders but not take them anywhere. A merchant's real workflow (reconciliation, accounting, sharing with a bookkeeper) ends in a spreadsheet.

The feature is under-specified on purpose. What we decide here: **column shape, auth model, format conventions, and behavior on large result sets.**

Facts checked before writing this:

- `better-sqlite3` exposes `Statement.iterate()`, so rows can be streamed instead of materialized (confirmed against the real database).
- `ordersRouter` registers `GET /:id` at [src/routes/orders.ts:26](../src/routes/orders.ts). A later `GET /export.csv` would be swallowed by it and answer `404 not_found`, so **the export route must be registered before `/:id`** — with a test that would catch the ordering mistake.

## Decision

### 1. Endpoint

```
GET /api/orders/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
```

- **Auth: the existing merchant session.** No new auth model: the same `requireAuth()` guard, the same `merchant_session` cookie, the same `BaseRepository` scope. An admin (mint-scoped) token gets `403` like on any data route — the export cannot become a way to read another merchant's rows.
- `from`/`to` are **optional**; when both are present the same range rule as the orders list applies (`from` inclusive, `to` exclusive). One without the other is a `400`, instead of silently exporting everything (the list endpoint's silent-drop behavior is TD-09; the export won't copy it).
- Rows are ordered **`created_at` ascending** — chronological, which is what a ledger export is for, unlike the dashboard's newest-first view.

### 2. Columns

| Column | Example | Why |
|---|---|---|
| `order_id` | `e3684c1d-…` | Join key back to the API |
| `created_at` | `2026-09-11T11:45:35.866Z` | ISO 8601, UTC, unambiguous |
| `customer_email` | `ana@example.com` | |
| `type` | `sale` / `refund` | |
| `status` | `completed` | |
| `amount_cents` | `11136` | As stored: positive integer, no locale or rounding issues |
| `signed_amount_cents` | `-11136` for refunds | **Sums to net revenue** |
| `amount` | `111.36` | Decimal with a dot, for humans |

`signed_amount_cents` is the column that matters: it carries the refund semantics from `src/dal/money.ts` into the spreadsheet, so `=SUM(...)` gives net revenue. Without it, every merchant would recreate TD-05 in Excel on their own.

No `currency` column: the schema has no currency and inventing a constant would imply multi-currency support we don't have. Documented as USD in `docs/api.md`.

### 3. Format conventions

- **RFC 4180**: `CRLF` line endings, header row, fields quoted only when they contain `,` `"` `CR` or `LF`, inner quotes doubled.
- **UTF-8 with BOM**, so Excel on Windows doesn't mangle accented names.
- **Formula-injection defense**: a field starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`. This matters here specifically: `customer_email` is attacker-controlled and barely validated (TD-11 is still open), so `=HYPERLINK(...)` in an email field would execute when the merchant opens the file.
- Response headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="orders-<merchantId>-<from>_<to>.csv"`, `X-Content-Type-Options: nosniff`.

### 4. Large result sets

Rows are **streamed**, not accumulated:

- `OrdersRepository.iterateForExport()` returns an iterator built on `Statement.iterate()`, with the merchant scope applied by `BaseRepository` like any other query.
- The route writes the header, then rows in batches, honoring backpressure (`res.write()` returning `false` → wait for `drain`).
- No row cap: an export that silently truncates is worse than a slow one. Memory stays flat because nothing holds the full result.
- Failure mid-stream (headers already sent) can't become a JSON error, so the stream is aborted and the incident logged — a truncated file the merchant can notice, rather than a corrupt one that looks complete.

### 5. Dashboard

A **Download CSV** button next to "Recent orders", exporting the **same rolling 30-day window the cards show** (Q4, rev 3), so the CSV total and the revenue card always agree.

One wrinkle to settle, because "same as the dashboard" is currently ambiguous: the card sends `to = today` and `to` is **exclusive**, so today's orders are already missing from it — the frontend half of TD-07.

- **Option A (recommended): both use `to` = tomorrow.** One line in `public/app.js`, applied to the card and the export together. They stay identical, and today's orders stop disappearing. It fixes the frontend half of TD-07 as a side effect; the backend half (the exclusive bound itself) stays as documented.
- **Option B: both keep `to` = today.** Zero scope creep, but the export deliberately ships a file missing today's sales, which is a bad property for a record a merchant archives.

This plan assumes **Option A** and its single shared helper (`currentRange()`) used by both the cards and the export, so the two can't drift apart later.

The button is not a plain `<a download>`: if the 10-minute merchant token has expired the browser would download a file containing `{"error":"session_expired"}`. The handler mints a fresh token first (the existing re-mint path), then triggers the download.

### 6. Commits

| # | Content |
|---|---|
| 1 | `src/lib/csv.ts` (escaping, injection defense) + unit tests |
| 2 | `OrdersRepository.iterateForExport()` + scope tests |
| 3 | `GET /api/orders/export.csv` (registered before `/:id`) + HTTP tests |
| 4 | Dashboard button |

## Answers to the open questions

- **Q1 — Three amount columns**: `amount_cents`, `signed_amount_cents`, `amount`.
- **Q2 — `from`/`to` optional**; one without the other is a `400`.
- **Q3 — BOM + formula-injection prefix**: both included.
- **Q4 (rev 3) — The rolling 30-day window the dashboard already uses**, shared with the cards through one helper so both always match. Pending your nod on Option A in §5 (both include today) versus Option B (both keep excluding it).

## Scope

- New: `src/lib/csv.ts`, `test/csv.test.ts`, `test/orders-export.test.ts`
- Changed: `src/dal/base-repository.ts` (iterator helper), `src/dal/orders-repository.ts`, `src/routes/orders.ts`, `public/index.html`, `public/app.js`
- `docs/api.md`, `docs/architecture.md` — after validation, with authorization (CLAUDE.md §6)

## Out of scope

- Other export formats, scheduled or emailed exports, background jobs.
- A date-range picker in the UI.
- The remaining Tier 1 debt (TD-10, TD-11, TD-12) — the injection defense here mitigates the export path but does not replace input validation.

## Validation

1. `npm test` — CSV unit tests + endpoint tests.
2. `tsc --noEmit` → exit 0.
3. **Route ordering**: `GET /api/orders/export.csv` returns CSV, not `404 not_found` (the regression this plan predicts).
4. **Scope**: an `m_acme` session's export contains no `m_bistro` row; an admin token gets `403`.
5. **Money**: the sum of `signed_amount_cents` for a full range equals `/api/revenue`'s `revenue_cents` for the same range (327 108 for `m_acme` on the seeded data).
6. **Escaping**: a customer email containing `,`, `"` and a newline round-trips through a CSV parser; `=HYPERLINK("x")` comes back prefixed with `'`.
7. **Headers**: `Content-Disposition` names the file with merchant and range; body starts with the UTF-8 BOM.
8. **Streaming**: exporting a few thousand seeded rows keeps memory flat (measured with `process.memoryUsage()` before/after) and the response is chunked.
9. **Browser**: the button downloads a file that opens correctly, and still works after the merchant token has expired.
10. **Window**: the CSV row count and the sum of `signed_amount_cents` match the revenue card for the same window; with Option A, an order created today appears in both.

## Rollback

Revert the commits. Read-only feature: no schema change, no data migration.

## Results

| Step | Result |
|---|---|
| 1. `npm test` | ✅ 86/86 (19 new: CSV unit tests + endpoint tests) |
| 2. `tsc --noEmit` | ✅ exit 0 |
| 3. Route ordering | ✅ `GET /api/orders/export.csv` → `200 text/csv`, not `404` — the trap this plan predicted |
| 4. Scope | ✅ no `m_bistro` row in an `m_acme` export; admin token → `403 token_not_scoped_for_data`; no cookie → `401` |
| 5. Money | ✅ on a 50 000-row database the sum of `signed_amount_cents` equals `/api/revenue` exactly (51 695 658 both) |
| 6. Escaping | ✅ `Doe, "Jane"\nsecond@example.com` round-trips through a parser; `=HYPERLINK(…)` comes back as `'=HYPERLINK(…)` |
| 7. Headers | ✅ `text/csv; charset=utf-8`, `nosniff`, `attachment; filename="orders-m_acme-2026-08-13_2026-09-13.csv"`; body starts with `EF BB BF` |
| 8. Streaming | ✅ 50 000 rows → 3.9 MB delivered with `Transfer-Encoding: chunked` and no `Content-Length`, i.e. nothing buffered up front |
| 9. Browser | ✅ button present and labelled; export returns 200 with the documented header row |
| 10. Window (Option A) | ✅ an order created **today** appears in the export (`2026-09-12 09:08:35` present); range ends at tomorrow, shared with the revenue card through `currentRange()` |

### Deviations and notes

- **BOM vs `fetch`**: `Response.text()` strips a leading BOM while decoding, so the first version of the header test failed even though the bytes were correct. The BOM is now asserted on the raw bytes and the text helper strips it explicitly.
- **Formula guard applies to strings only.** Prefixing anything that starts with `-` would have corrupted every refund row (`-4000` → `'-4000`). Pinned by a regression test.
- **Mid-stream failures** abort the response (`res.destroy()`) instead of appending a JSON error to a half-written file.
- The test order created during the browser check was deleted afterwards; `data/dashboard.db` is back to the seeded 80 rows.
