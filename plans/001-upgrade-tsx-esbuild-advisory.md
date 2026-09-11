# 001 — Upgrade `tsx` to clear the esbuild advisory

**Status:** done (2026-09-11)

## Context

After the initial `npm install` + `npm audit fix`, `npm audit` still reports 3 vulnerabilities from 2 root causes. This plan addresses only the esbuild one.

| Field | Value |
|---|---|
| Package | `esbuild@0.27.7` (transitive, devDependency) |
| Pulled in by | `tsx@4.21.0`, which pins `esbuild: ~0.27.0` |
| Advisory | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) — arbitrary file read via path traversal |
| Severity | Low (CVSS 2.5) |
| Affected / patched | `>=0.27.3 <0.28.1` / `0.28.1` |
| Exploit conditions | Windows **and** esbuild's dev server running with `servedir` |
| Exploitable here? | No. `tsx` only uses esbuild as a compiler and never starts its dev server (no `servedir` / `.serve(` in `node_modules/tsx/dist`). Dev-only, never shipped. |

Real risk is effectively nil; the goal is audit hygiene at near-zero cost.

## Decision

Upgrade `tsx` to `^4.23.13` (current latest), which depends on `esbuild ~0.28.0` and resolves to `esbuild@0.28.2`.

```sh
npm install --save-dev tsx@^4.23.13
```

This also raises the declared floor in `package.json` from `^4.19.0` to `^4.23.13`, so a fresh install without the lockfile can never resolve back to a vulnerable `tsx`.

### Why it's safe

- `tsx@4.22.0`'s only change is "upgrade esbuild to 0.28" (#789). `4.23.x` releases are bug fixes; no breaking changes, no dropped Node versions (`engines: node >=18`; project requires `>=20`, local is Node 24).
- esbuild `0.28.0`'s only breaking change is integrity checks on the fallback binary download path — install-time only, no API impact.
- Simulated on a lockfile copy: `tsx@4.23.13` + `esbuild@0.28.2`, and the esbuild advisory disappears from `npm audit`.

### Rejected alternatives

- **Lockfile-only bump (`npm update tsx`) keeping `^4.19.0`** — fixes the lockfile, but the declared range would still allow a vulnerable `tsx`. Rejected for being less explicit.
- **`overrides` forcing `esbuild@0.28.x` under `tsx@4.21`** — forces a version outside `tsx`'s declared range when an official `tsx` release already ships it. Rejected.
- **Do nothing (risk accepted)** — defensible given the nil exploitability, but the fix costs nothing and keeps the audit clean so real alerts aren't drowned out.

## Scope

- `package.json` — `devDependencies.tsx` range.
- `package-lock.json` — `tsx`, `esbuild`, and `@esbuild/*` platform packages.

## Out of scope

- The `qs` advisories (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g) via `express@4.22.2` — options B (override) and C (Express 5) are pending a separate decision.
- Any `tech_debt.md` item or application code change.

## Pre-condition

`package-lock.json` already has uncommitted changes from the earlier `npm audit fix` (`body-parser` 1.20.5 → 1.20.8, nested `qs@6.16.0`). The user should commit that separately **before** this plan runs, so this plan's diff is isolated.

## Validation

1. `npm ls tsx esbuild` → `tsx@4.23.x`, `esbuild@0.28.1+`.
2. `npm audit` → no esbuild entry; only the `qs`/`express` entries remain.
3. `npm test` → passes (runs through `node --import tsx`).
4. `npm run build` (`tsc`) → no new errors.
5. `npm run dev` → server starts, watch mode reloads on a file save, and the dashboard at `http://localhost:3000` loads data for both merchants.

## Rollback

Revert `package.json` and `package-lock.json`, then `npm ci`.

## Results

Executed by the user with `npm install --save-dev tsx@^4.23.13`.

| Step | Result |
|---|---|
| 1. `npm ls tsx esbuild` | ✅ `tsx@4.23.13` → `esbuild@0.28.2`; `package.json` declares `^4.23.13` |
| 2. `npm audit` | ✅ esbuild advisory gone; 2 moderate remain (`qs` via `express`), as expected — out of scope |
| 3. `npm test` | ✅ 2/2 pass |
| 4. Type-check | ✅ `tsc --noEmit` exit 0 (used instead of `npm run build` to avoid emitting `dist/`) |
| 5. Server smoke test | ✅ on port 3055: `/api/health` ok, `/api/metrics/summary` and `/api/orders` return data for `m_acme` and `m_bistro`, `/` serves the dashboard (200) |
| 5b. Watch-mode reload + visual dashboard check | ⚠️ Not verified by Claude — pending manual check by the user |

Note: `npm audit fix` still reports "fix available" for `qs`, but cannot apply it — `express@4.22.2` (latest 4.x) pins `qs ~6.15.1`, and the fix is in `6.16.0`.
