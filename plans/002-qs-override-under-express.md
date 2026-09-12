# 002 — Override `qs` under `express` to clear the qs advisories

**Status:** done (2026-09-11) — approved via user instruction: "verify if the override resolves it; if it does, apply it"

## Context

After plan 001, `npm audit` still reports 2 moderate vulnerabilities, both from `qs@6.15.3` pulled in by `express@4.22.2`:

| Advisory | Severity (CVSS) | Exploit conditions | Exploitable here? |
|---|---|---|---|
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — `arrayLimit` bypass via bracket-key comma parsing | Moderate (3.7) | `qs.parse` with `comma: true` | No — Express 4 parses `req.query` with `{ allowPrototypes: true, arrayLimit: 1000 }`, `comma` stays `false` |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — DoS via attacker-controlled `isBuffer` | Moderate (5.3) | `qs.parse` with `allowPrototypes: true` **and** the result passed to `qs.stringify` | Not today — first condition is met, but the app never re-serializes `req.query`. Would become exploitable if code rebuilds query strings with `qs.stringify` (e.g. pagination links) |

The fix is in `qs@6.16.0`, but `express@4.22.2` — the latest 4.x — pins `qs ~6.15.1`, so no Express 4 release can pick it up and `npm audit fix` cannot apply it.

## Decision

Add an npm `overrides` entry scoped to the `express` subtree:

```json
"overrides": {
  "express": {
    "qs": "^6.16.0"
  }
}
```

Then `npm install` to rewrite the lockfile.

### Why it's safe

- `qs@6.16.0` changelog: bug fixes plus a new `stringify` `depth` option (defaults to `Infinity`). `parse` with default options is backward compatible with 6.15.x.
- No application code changes.
- Simulated on a copy of the current lockfile: single `qs@6.16.0` in the tree (the nested `body-parser` copy dedupes into it), `npm audit` → **0 vulnerabilities**.

### Rejected alternatives

- **Option C — migrate to Express 5.2.1 (+ `npm update qs`)**: cleaner long-term (default query parser becomes `'simple'`, taking `qs` off the `req.query` path; aligns with `@types/express@5` already installed). Rejected for now: it's a major upgrade with one confirmed behavior change in this repo — `req.body` is `undefined` when not parsed, so `POST /api/orders` without a JSON `Content-Type` would go from 400 to 500 ([src/routes/orders.ts:26](../src/routes/orders.ts)). Worth its own plan later.
- **Global override (`"qs": "^6.16.0"` at the top level)**: broader than needed; scoping to `express` limits the blast radius.
- **Do nothing (risk accepted)**: neither advisory is exploitable today, but the second one is one `qs.stringify` call away from being live.

### Maintenance cost

The override forces a version outside `express`'s declared range. Remove it once Express 4 ships a patch that accepts `qs >=6.16.0`, or when migrating to Express 5.

## Scope

- `package.json` — new `overrides` block.
- `package-lock.json` — `qs` resolution.

## Out of scope

- Express 5 migration.
- Any `tech_debt.md` item or application code change.

## Validation

1. `npm ls qs` → only `qs@6.16.0` under `express` / `body-parser`, no `invalid` markers.
2. `npm audit` → 0 vulnerabilities.
3. `npm test` → passes.
4. `tsc --noEmit` → exit 0.
5. Server smoke test: query-string endpoints still parse correctly (`/api/orders?limit=…`, `/api/revenue?from=…&to=…`, `/api/metrics/top-customers?limit=…`) for both merchants.

## Rollback

Remove the `overrides` block, then `npm install`.

## Results

Applied by Claude: added the `overrides` block to `package.json`, then `npm install`.

| Step | Result |
|---|---|
| 1. `npm ls qs` | ✅ `express@4.22.2` → `qs@6.16.0`; `body-parser@1.20.8` → `qs@6.16.0 deduped`; no `invalid` markers |
| 2. `npm audit` | ✅ 0 vulnerabilities |
| 3. `npm test` | ✅ 2/2 pass |
| 4. `tsc --noEmit` | ✅ exit 0 |
| 5. Server smoke test (port 3055) | ✅ `/api/orders?limit=2` → 2 rows, `/api/revenue?from=…&to=…` and `/api/metrics/top-customers?limit=2` return data for `m_acme` and `m_bistro` |
| 5b. Visual dashboard check | ⚠️ Not verified by Claude — pending manual check by the user |

No `docs/` update needed: the override resolved the advisories, so there is no pending upgrade to document.
