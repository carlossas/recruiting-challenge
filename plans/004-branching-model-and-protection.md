# 004 — Branching model (`develop` → `main`), branch protection, and workflow docs

**Status:** in progress — Claude steps 1–5 and 9 (docs) done (2026-09-11); waiting on user steps 6–8

> Step 9 was brought forward at the user's request so `docs/github-workflow.md` ships in the same commit as the rest of the work. If the first PR (validation 4–6) reveals a difference, the doc is updated in a follow-up.

## Context

The user wants:
- A `develop` branch as the **default branch**. **All PRs target `develop`** (protected).
- `main` is **only for production deployments**: it receives releases from `develop` (also protected).
- The process documented in `docs/` as "GitHub workflow — Releases and branches".

Current state (checked with `gh`, read-only):
- Remote `origin` = `github.com/carlossas/recruiting-challenge` — public fork of `PlataformaT1/recruiting-challenge`. Default branch `main`. Only `main` exists remotely (`cbf80ec`, same as local `HEAD`).
- `gh` 2.100.0 installed at `C:\Program Files\GitHub CLI\gh.exe` (not on this session's `PATH`; called by full path). Logged in as `carlossas`, permission `ADMIN`, token scopes `repo`, `workflow`.
- No rulesets and no classic branch protection yet.
- Actions: `enabled: true`, `allowed_actions: all` at the repo level.
- Merge methods allowed: merge, squash, rebase.
- The submission is scored partly on commit history ("multiple commits, not one giant squash" — EVALUATION.md), so merges must preserve individual commits.

## Answers to the open questions (user)

- **Q1 — Required approvals: 0.** It's a single-maintainer challenge; GitHub doesn't allow approving your own PR.
- **Q2 — Rules apply to administrators: yes.** No bypass actors, so the owner can't push directly either.
- **Q3 — Default branch: `develop`.** `main` is only for production deployments.

## Decision

### 1. Branch model

```
feature/*, fix/*, chore/*  ──PR──▶  develop (default)  ──release PR──▶  main (production)
```

| Branch | Purpose | Created from | Merges into | Direct pushes |
|---|---|---|---|---|
| `main` | Production — only what's deployed | — | — | ❌ |
| `develop` | Default + integration branch | `main` | `main` (release PR) | ❌ |
| `feature/<slug>`, `fix/<slug>`, `chore/<slug>` | One topic each (ideally one plan) | `develop` | `develop` | ✅ (owner's branch) |

- **Merge method: merge commit only** (enforced by the rulesets) for both feature → `develop` and `develop` → `main`. Keeps every human-written commit visible.
- A release = a PR from `develop` into `main`.

### 2. Enforce "only `develop` can merge into `main`"

GitHub has no native "allowed source branch" rule, so a second job is added to `.github/workflows/ci.yml` and required on `main`:

```yaml
  release-source:
    name: release-source
    if: github.base_ref == 'main'
    runs-on: ubuntu-latest
    steps:
      - name: Only develop from this repo can be merged into main
        env:
          HEAD_REF: ${{ github.head_ref }}
          HEAD_REPO: ${{ github.event.pull_request.head.repo.full_name }}
          BASE_REPO: ${{ github.repository }}
        run: |
          if [ "$HEAD_REF" != "develop" ] || [ "$HEAD_REPO" != "$BASE_REPO" ]; then
            echo "::error::PRs into main must come from 'develop' in $BASE_REPO (got '$HEAD_REPO:$HEAD_REF')"
            exit 1
          fi
```

- Values go through `env`, never interpolated into the shell script (no script injection via branch names).
- Checks the head **repo** too, so a fork's branch named `develop` can't pass.
- On PRs into `develop` the job is skipped, which GitHub treats as passing — it's only *required* on `main`.

### 3. Branch protection via repository rulesets (`gh api`)

Rulesets instead of classic branch protection: they are the current GitHub mechanism, can restrict merge methods, and accept required checks by name **before they have ever run** (so protection can be applied before the first PR).

The ruleset definitions are versioned in the repo so they're reviewable and reproducible:

- `.github/rulesets/develop.json`
- `.github/rulesets/main.json`

(GitHub does not read this folder automatically; it's only storage. They're applied with `gh`.)

| Rule | `develop` | `main` |
|---|---|---|
| Restrict deletions | ✅ | ✅ |
| Block force pushes (`non_fast_forward`) | ✅ | ✅ |
| Require a pull request | ✅ | ✅ |
| Required approvals | 0 (Q1) | 0 (Q1) |
| Allowed merge methods | `merge` only | `merge` only |
| Required status checks | `check-deps` | `check-deps`, `release-source` |
| Require branch up to date (`strict`) | ✅ | ❌ — see note |
| Checks must come from GitHub Actions (`integration_id: 15368`) | ✅ | ✅ |
| Bypass actors | none (Q2 — applies to admins) | none (Q2) |

**Why `strict` is off on `main`:** each release merge creates a merge commit on `main` that `develop` doesn't have. With `strict` on, the next release PR would require updating `develop` from `main`, which means pushing a merge commit directly to `develop` — blocked by `develop`'s own ruleset. Leaving it off avoids that deadlock; `check-deps` still runs on the release PR.

**`integration_id: 15368`** (the GitHub Actions app) means the required checks only count when reported by Actions, so a manually posted commit status with the same name can't satisfy them.

Example (`develop.json`):

```json
{
  "name": "develop",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/heads/develop"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "check-deps", "integration_id": 15368 }]
      }
    }
  ]
}
```

`main.json` is the same with `refs/heads/main`, `strict_required_status_checks_policy: false`, and both `check-deps` and `release-source`.

### 4. Repository settings (`gh`)

```sh
gh repo edit carlossas/recruiting-challenge --default-branch develop
gh repo edit carlossas/recruiting-challenge --enable-merge-commit --enable-squash-merge=false --enable-rebase-merge=false
```

The second command mirrors the rulesets at repo level so the PR UI only offers "Create a merge commit".

### 5. CLAUDE.md

Add to §2 (Git): the branch model; `develop` is the default branch and `main` is production-only; Claude never pushes to `main` or `develop`; work happens on `feature/*`/`fix/*`/`chore/*` branches merged via PR.

### 6. Docs: `docs/github-workflow.md` — "GitHub workflow — Releases and branches"

Written **after** the change is validated (CLAUDE.md §6; the user has already authorized this doc). Contents:
- Branch model diagram (mermaid) and naming conventions.
- **`develop` is the default branch; `main` is only for production deployments.**
- Day-to-day flow: branch from `develop` → PR → checks → merge commit.
- Release flow: PR `develop` → `main`, merge commit.
- CI checks: what `check-deps` and `release-source` do; severity policy (critical/high block, moderate/low warn, audit failure blocks); how to run `npm run check:deps` locally.
- Protection rules (table in §3), where the ruleset JSON lives, and how to re-apply/update them with `gh`.
- What's *not* enforced (approvals = 0, no hotfix flow yet).

## Execution steps

Commits are human-written (CLAUDE.md §2): the user commits; Claude prepares files and runs only approved commands. `gh` is invoked as `"/c/Program Files/GitHub CLI/gh.exe"`.

**Claude (after approval + explicit go for the push):**

1. Add the `release-source` job to `.github/workflows/ci.yml`; write `.github/rulesets/develop.json` and `.github/rulesets/main.json`; update CLAUDE.md §2.
2. Create and push `develop` (starts at `cbf80ec`, identical to `main`; uncommitted work stays in the working tree):
   ```sh
   git branch develop main
   git push -u origin develop
   ```
3. Repo settings:
   ```sh
   gh repo edit carlossas/recruiting-challenge --default-branch develop
   gh repo edit carlossas/recruiting-challenge --enable-merge-commit --enable-squash-merge=false --enable-rebase-merge=false
   ```
4. Rulesets:
   ```sh
   gh api -X POST repos/carlossas/recruiting-challenge/rulesets --input .github/rulesets/develop.json
   gh api -X POST repos/carlossas/recruiting-challenge/rulesets --input .github/rulesets/main.json
   ```
   (To update later: `gh api -X PUT repos/carlossas/recruiting-challenge/rulesets/<id> --input …`.)
5. Verify the configuration via API (validation 1–3).

**User:**

6. Create a branch from `develop` (e.g. `chore/ci-deps-and-plans`), commit the pending work (plans 001–004, `CLAUDE.md`, `tech_debt.md`, dependency changes, `check:deps`, workflow, rulesets) with their own messages, push, open a PR into `develop`.
7. Confirm `check-deps` runs and passes (`release-source` skipped). If the workflow doesn't start, enable Actions on the fork's *Actions* tab.
8. Merge the PR into `develop` with a merge commit.

**Claude (after step 8, with the user's authorization already given):**

9. Write `docs/github-workflow.md`. The user commits it through the same flow.

## Scope

- Local + remote branch `develop`.
- `.github/workflows/ci.yml` — `release-source` job.
- `.github/rulesets/develop.json`, `.github/rulesets/main.json` (new).
- GitHub repo settings: default branch, merge methods, two rulesets.
- `CLAUDE.md` — branch rules in §2.
- `docs/github-workflow.md` (new) — after validation.

## Out of scope

- Hotfix flow (`hotfix/*` from `main` + back-merge into `develop`).
- Tags / GitHub Releases / versioning / changelog / actual deployment pipeline for `main`.
- Any change to the upstream `PlataformaT1/recruiting-challenge` repo.

## Validation

Claude (API, right after steps 2–4):
1. `git ls-remote --heads origin` → `develop` and `main` at the same commit.
2. `gh repo view --json defaultBranchRef,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed` → `develop`, `true`, `false`, `false`.
3. `gh api repos/carlossas/recruiting-challenge/rules/branches/develop` and `…/main` → the rules in §3, no bypass actors.

User (on GitHub):
4. First PR into `develop`: `check-deps` passes, `release-source` skipped, only "Create a merge commit" is offered. Also confirms `npm ci --ignore-scripts` works on the runner (plan 003, step 8).
5. A direct `git push` to `develop` or `main` is rejected.
6. A PR from any branch other than `develop` into `main` fails `release-source` and can't be merged (throwaway branch, then close the PR).
7. At the first release: PR `develop` → `main` passes both checks.

## Rollback

```sh
gh api repos/carlossas/recruiting-challenge/rulesets            # find ids
gh api -X DELETE repos/carlossas/recruiting-challenge/rulesets/<id>
gh repo edit carlossas/recruiting-challenge --default-branch main --enable-squash-merge --enable-rebase-merge
git push origin --delete develop    # only with explicit go
git branch -d develop
```

Then remove the `release-source` job, the ruleset JSON files, and the CLAUDE.md §2 additions.

## Results

### Claude steps (1–5) — done 2026-09-11

| Step | Result |
|---|---|
| 1. Files | ✅ `release-source` job added to `.github/workflows/ci.yml`; `.github/rulesets/develop.json` and `main.json` written (valid JSON); CLAUDE.md §2 updated with the branch model |
| 2. `develop` branch | ✅ `git branch develop main` + `git push -u origin develop` → `develop` and `main` both at `cbf80ec` on `origin` |
| 3. Repo settings | ✅ `gh repo edit` → default branch `develop`; merge commit only (squash and rebase disabled) |
| 4. Rulesets | ✅ Created via `gh api -X POST …/rulesets`: `develop` = id **22970322**, `main` = id **22970325**, both `enforcement: active` |

### Validation

| Check | Result |
|---|---|
| 1. `git ls-remote --heads origin` | ✅ `develop` and `main` at `cbf80ec` |
| 2. `gh repo view` | ✅ `defaultBranchRef: develop`, `mergeCommitAllowed: true`, `squashMergeAllowed: false`, `rebaseMergeAllowed: false` |
| 3a. Effective rules on `develop` | ✅ `deletion`, `non_fast_forward`, `pull_request` (0 approvals, `merge` only), `required_status_checks` (`check-deps` from Actions `15368`, strict ✅); `bypass_actors: []`, `current_user_can_bypass: never` |
| 3b. Effective rules on `main` | ✅ same, with `check-deps` + `release-source`, strict ❌; `bypass_actors: []`, `current_user_can_bypass: never` |
| 4. First PR into `develop` | ⏳ user |
| 5. Direct push rejected | ⏳ user |
| 6. Non-`develop` PR into `main` fails `release-source` | ⏳ user |
| 7. First release PR passes both checks | ⏳ user, at the first release |

To update a ruleset later: `gh api -X PUT repos/carlossas/recruiting-challenge/rulesets/<id> --input .github/rulesets/<branch>.json`.
