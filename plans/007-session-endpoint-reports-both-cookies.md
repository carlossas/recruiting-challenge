# 007 — The session endpoint must describe both cookies

**Status:** done (2026-09-12) — fixed and validated; `docs/api.md` pending authorization

Fixes a regression introduced by [plan 005](005-jwt-auth-and-scoped-repositories.md). Reported by the user: after reloading the dashboard, the merchant picker disappears and the page is stuck on "Viewing m_acme".

## Context

A browser can hold **two** session cookies at once — `admin_session` (minting) and `merchant_session` (data) — but `GET /api/auth/session` describes only one, checking the merchant cookie first:

```ts
for (const name of [MERCHANT_COOKIE, ADMIN_COOKIE]) { … }   // src/routes/auth.ts:106
```

Reproduced against a running server:

| State | `/api/auth/session` | Picker |
|---|---|---|
| First load (admin cookie only) | `{"role":"admin","merchantId":null}` | shown ✅ |
| After picking a merchant (both cookies) | `{"role":"merchant","merchantId":"m_acme"}` | **hidden ❌** |

The frontend reads `role === 'merchant'` as "this session is bound to one merchant, there is nothing to switch between" ([public/app.js:96](../public/app.js)), which is right for a real merchant login and wrong here: the admin cookie is still present and still able to mint.

It is not a pre-existing bug — before plan 005 the picker was hardcoded in the HTML and always visible.

Worth noting: the bug **heals itself after ~10 minutes**, when the merchant token expires and the endpoint starts answering `admin` again. An intermittent UI bug is worse than a permanent one, because it doesn't reproduce on the second try.

## Decision

### 1. The endpoint reports capability, not just identity

`GET /api/auth/session` keeps its current top-level shape (the *effective* session, merchant preferred) and gains one field:

```json
{
  "role": "merchant", "scope": "data", "merchantId": "m_acme",
  "expiresAt": "2026-09-12T07:53:45.000Z",
  "canSwitchMerchants": true
}
```

`canSwitchMerchants` is `true` when a **valid** `admin_session` cookie is present — i.e. when `POST /api/auth/token` would succeed. It is derived from verifying that cookie, not from its mere existence, so an expired admin token doesn't leave a picker on screen that fails on click.

Rejected alternatives:

- **Return both sessions** (`{ merchant: …, admin: … }`) — more faithful, but it breaks the current response shape and the frontend only needs one bit.
- **Have the frontend remember it minted a merchant token** (e.g. `sessionStorage`) — client-side state that lies after the admin cookie expires.
- **Reorder the loop to check the admin cookie first** — that only moves the bug: a real merchant-only session would then be described as admin… and there'd be no admin cookie to describe.

### 2. The frontend decides by capability

`start()` becomes:

- `canSwitchMerchants === true` → load `/api/merchants`, populate and show the picker, preselect `merchantId` from the session when there is one (that's the reload case), otherwise select the first merchant and mint.
- `canSwitchMerchants === false` and `role === 'merchant'` → hide the picker (a genuine merchant-scoped session).
- On reload with a still-valid merchant cookie, no new token is minted: the existing session is reused and the data is just refreshed.

### 3. Regression test

`test/auth-guard.test.ts` gains cases for the three cookie combinations:

| Cookies | `role` | `canSwitchMerchants` |
|---|---|---|
| admin only | `admin` | `true` |
| admin + merchant | `merchant` | `true` |
| merchant only | `merchant` | `false` |

The middle row is the bug: it fails today.

## Scope

- `src/routes/auth.ts` — `GET /api/auth/session`
- `public/app.js` — `start()`
- `test/auth-guard.test.ts` — three session cases
- `docs/api.md` — the new field (needs authorization, CLAUDE.md §6)

## Out of scope

- Any change to how tokens are minted, scoped or verified.
- The remaining Tier 1 groups (C, D).

## Validation

1. `npm test` — the new cases fail before the fix and pass after.
2. `tsc --noEmit` → exit 0.
3. `curl` with both cookies → `canSwitchMerchants: true`.
4. Browser: pick `m_bistro`, **reload** → the picker is still there, still on `m_bistro`, data matches.
5. Browser: wait out the merchant token (or mint one with a 1s TTL), reload → picker still shown, a fresh token is minted on demand.

## Rollback

Revert the commit; the endpoint returns to describing a single session.

## Results

Written test-first: the four new session cases were added and run **before** the fix, and failed (63 pass / 4 fail) — so the regression test demonstrably catches the bug.

| Step | Result |
|---|---|
| 1. `npm test` | ✅ 67/67 after the fix (4 new cases, all failing beforehand) |
| 2. `tsc --noEmit` | ✅ exit 0 |
| 3. Session shape | ✅ admin only → `role: admin`, `canSwitchMerchants: true`; both cookies → `role: merchant`, `canSwitchMerchants: true`; merchant only → `false`; expired admin cookie → `false` |
| 4. Browser reload | ✅ picked `m_bistro`, reloaded: picker still shown, still on `m_bistro`, revenue unchanged at `$1,147.23`, session reports `canSwitchMerchants: true` |
| 5. Expired merchant token | ✅ covered by unit tests (`session_expired` → the page re-mints on demand); not re-checked live |

### Notes

- `readSession()` also checks the token's **scope**, so a merchant token planted in the `admin_session` cookie can't advertise minting rights it doesn't have.
- On reload with a live merchant session the dashboard reuses it instead of minting another token — fewer tokens issued, and the selection survives the reload.
- Root cause worth remembering: the endpoint described *identity* when the UI needed *capability*. The tests missed it because each case sent a single cookie, while the app's normal state carries two.
