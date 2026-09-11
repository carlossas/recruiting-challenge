# 003 — `check:deps` script + CI workflow to gate dependency vulnerabilities

**Status:** done locally (2026-09-11) — GitHub run pending (validation step 8, after plan 004 bootstrap)

## Context

Plans 001 and 002 cleared all current advisories (`npm audit` → 0 vulnerabilities). To keep it that way, the user wants a `check:deps` npm script that runs in a GitHub Actions pipeline on every PR.

Current state of the repo:
- **No CI pipeline yet** (no `.github/`). The remote is a public GitHub fork (`carlossas/recruiting-challenge`, parent `PlataformaT1/recruiting-challenge`).
- `npm audit --audit-level=<level>` alone is not enough: it can set the exit code by threshold, but it can't emit *warnings* for lower severities while passing, and its output isn't annotated for CI.

## Decision

### 1. Severity policy (answered by the user)

| Severity | Output | Exit code |
|---|---|---|
| `critical` | error per package | `1` — **blocks the PR** |
| `high` | error per package | `1` — **blocks the PR** |
| `moderate`, `low` | warning per package | `0` |
| `info` | ignored | `0` |
| none | `✔ No known vulnerabilities` | `0` |
| `npm audit` could not run (registry/network error, non-JSON output, JSON `error` payload) | explicit error: `npm audit could not run: <reason>` — makes clear that **nothing was checked** | `1` — **blocks the PR** (fail closed) |

### 2. Script: `src/scripts/check-deps.ts`

TypeScript, run with `tsx`, next to the existing `src/scripts/seed.ts` (same convention; covered by `tsc`, since `tsconfig.json` only includes `src/**`). It must **not** import `src/db.ts` or anything that opens SQLite.

Split so the logic is testable without the network:

- **`evaluateAudit(report)`** — pure function. Input: parsed `npm audit --json` report. Output: `{ errors, warnings, exitCode }`.
- **`runAudit()`** — spawns `npm audit --json` and returns either the parsed report or an "audit could not run" failure with the reason.
- **`main()`** — wires both, prints results, sets `process.exitCode`.

Output per package: name, severity, advisory title + URL, direct vs transitive, prod vs dev, fix available. A summary line with counts per severity at the end.

**CI annotations:** when `GITHUB_ACTIONS === 'true'`, lines are emitted as `::error title=…::…` / `::warning title=…::…` so they show up on the PR's checks. Otherwise plain `console.error` / `console.warn` with an `ERROR` / `WARN` prefix.

Implementation notes:
- `npm audit` exits non-zero whenever it finds anything, so its exit code is **not** used for the decision; only the parsed JSON is. Its exit code is used only to help classify "could not run" when stdout isn't valid JSON.
- Spawned via `child_process.spawnSync('npm', ['audit', '--json'], { shell: process.platform === 'win32' })` — on Windows `npm` is `npm.cmd`, which Node 20+ refuses to spawn without a shell.
- Scans **all** dependencies (prod + dev).
- No new dependencies. TSDoc on the module and every exported function (CLAUDE.md §1).

### 3. `package.json`

```json
"check:deps": "tsx src/scripts/check-deps.ts"
```

### 4. Tests: `test/check-deps.test.ts`

Unit tests for `evaluateAudit` with inline fixtures shaped like real `npm audit --json` output (the report captured during plan 001 is a real sample):

- No vulnerabilities → exit 0, nothing reported.
- Only `low` + `moderate` → exit 0, one warning per package.
- One `high` → exit 1, one error.
- One `critical` among moderates → exit 1, one error + the warnings.
- `info` only → exit 0, nothing reported.
- Audit "could not run" failure → exit 1, explicit message.

### 5. Workflow: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [develop, main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  check-deps:
    name: check-deps
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run check:deps
```

- Triggers on PRs into `develop` and `main` (branch model defined in plan 004).
- Job name `check-deps` is the status-check name that branch protection will require (plan 004).
- **Node 24**: matches local dev; Node 20 reached end-of-life in April 2026 (`engines: >=20` is left unchanged — out of scope).
- `npm ci --ignore-scripts`: a security check job shouldn't run third-party install scripts, and the script doesn't need `better-sqlite3`'s native build. If `tsx`/esbuild fails without scripts on the runner, fall back to plain `npm ci` (to be confirmed in the first real run).
- `permissions: contents: read` — least privilege.

## Scope

- `src/scripts/check-deps.ts` (new)
- `test/check-deps.test.ts` (new)
- `package.json` — `scripts.check:deps`
- `.github/workflows/ci.yml` (new)

## Out of scope

- Fixing any vulnerability.
- Other CI jobs (tests, type-check) — easy to add to the same workflow later.
- Branch model, branch protection, and its docs — plan 004.
- `docs/` for this script — covered by the plan 004 doc, written after validation (CLAUDE.md §6).

## Validation

Local (Claude):
1. `npm test` → existing + new `check-deps` tests pass.
2. `tsc --noEmit` → exit 0.
3. `npm run check:deps` on the current repo → `✔ No known vulnerabilities`, exit 0.
4. Warning case: scratchpad copy **without** the plan 002 override (`qs@6.15.3`) → 2 warnings (`qs`, `express`), exit 0.
5. Annotation format: same copy with `GITHUB_ACTIONS=true` → lines start with `::warning`.
6. "Could not run" case: run with an unreachable registry (`npm_config_registry=http://127.0.0.1:9`) → explicit error message, exit 1.
7. `critical` / `high`: covered by unit-test fixtures (no real advisory available to reproduce).

On GitHub (user, after the first PR — see plan 004):
8. The `check-deps` check appears on the PR and passes.

## Rollback

Delete the new files and remove the `check:deps` entry from `package.json`.

## Results

Implemented by Claude: `src/scripts/check-deps.ts`, `test/check-deps.test.ts`, `package.json` (`check:deps`), `.github/workflows/ci.yml`.

| Step | Result |
|---|---|
| 1. `npm test` | ✅ 16/16 (14 new `check-deps` tests + 2 existing) |
| 2. `tsc --noEmit` | ✅ exit 0 |
| 3. `npm run check:deps` on the repo | ✅ `✔ No known vulnerabilities`, exit 0 |
| 4. Warning case (scratchpad copy, `qs@6.15.3`, no override) | ✅ 2 `WARN` lines (`express` direct/prod, `qs` transitive/prod with both advisories), `PASSED with 2 warning(s)`, exit 0 |
| 5. Same with `GITHUB_ACTIONS=true` | ✅ `::warning title=moderate vulnerability%3A …::…` on stdout, exit 0 |
| 6. `npm audit` can't run (`npm_config_registry=http://127.0.0.1:9`) | ✅ `npm audit could not run: … ECONNREFUSED 127.0.0.1:9. No dependencies were checked, so the gate fails closed.` — exit 1; as `::error` under `GITHUB_ACTIONS=true` |
| 7. `critical` / `high` | ✅ covered by unit tests (`high blocks`, `critical blocks …`) |
| 8. `check-deps` check on a real PR | ⏳ Pending — needs Actions enabled on the fork and the first PR (plan 004) |

### Deviations from the plan

- **Spawn call:** the plan said `spawnSync('npm', ['audit', '--json'], { shell: win32 })`. On Windows that triggers Node's `DEP0190` deprecation warning (args + `shell: true`). Changed to `spawnSync('npm audit --json', { shell: true })` on every platform — a constant command string with no user input, so nothing to escape.
- **npm 11 error shape:** with an unreachable registry, `npm audit --json` returns `{ "message": "…", "error": { "summary": "", "detail": "" } }` with exit code 0. The parser now reads the top-level `message` (plus `code`/`summary`/`detail` when present) and doesn't append stderr noise when the JSON already carries the reason. A unit test pins this real shape.

### Not verified yet

- `npm ci --ignore-scripts` on the GitHub runner (Linux) — `tsx`/esbuild should work without install scripts, but it's only confirmed at step 8. Fallback: plain `npm ci`.
