# CLAUDE.md — Golden rules

This repo is a recruiting challenge. What's evaluated is the candidate's judgment, and some deliverables **must be written by a human, without AI**. See [SUBMISSION.md](SUBMISSION.md) and [EVALUATION.md](EVALUATION.md).

## 1. Language
- **Everything written to the repo is in English**: code, identifiers, code comments, docs, plans, and any other file.
- Conversation with the user may stay in Spanish.
- **Docstrings are mandatory**: every exported function, class, router handler, and module gets a TSDoc/JSDoc `/** ... */` block. Inline `//` comments only for non-obvious logic.

## 2. Git: never without an explicit order
- **No commits, amends, rebases, squashes, or pushes.** Commit messages are human deliverables.
- **Never propose or draft commit messages**, not even as a suggestion.
- No branches, PRs, or forks unless the user explicitly asks.
- **Branch model** (see `docs/github-workflow.md`, plan 004):
  - `develop` is the default branch; all PRs target it.
  - `main` is production-only; it only receives release PRs from `develop`.
  - Work happens on `feature/*`, `fix/*`, or `chore/*` branches created from `develop`, merged via PR with a merge commit (no squash/rebase).
  - Never push to `main` or `develop` — both are protected by rulesets with no bypass.

## 3. Human deliverables: never write or edit them
Never create, draft, rewrite, polish, or restyle:
- `decision_log.md`
- `validation_design.md`
- `signoff.md`
- `written_answers.md`
- The **authorship declarations** of any of them.

No drafts, prose outlines, or copy-ready sentences either. If asked for help, provide only **technical facts** (code facts, paths, line numbers) and let the user write.

## 4. `prompt_history.md` is a raw transcript
- Never generate, summarize, curate, or edit it. The user assembles it.
- Never write the "What Claude got wrong" section.

## 5. Plans first: `plans/`
- **Every decision agreed with the user is documented in `plans/` before writing any code.**
- One file per change: `plans/NNN-short-slug.md` (e.g. `plans/001-orders-tenant-scope.md`).
- `NNN` is a zero-padded, strictly ascending sequence (`001`, `002`, `003`, …) reflecting the order plans are executed. Always take the next number after the highest existing one; never reuse or renumber.
- Each plan covers: context/problem, agreed decision, rejected alternatives, scope and out-of-scope, validation (tests, manual checks), and status (`draft` → `approved` → `done`).
- No code changes until the user approves the plan. If the approach changes mid-way, update the plan first.

## 6. Documentation: `docs/`
- `docs/` holds the repository documentation.
- Update it **only after the change is finished and validated**, and **only after asking the user for authorization**.
- Never modify `README.md`, `EVALUATION.md`, `SUBMISSION.md`, or the `*.template.md` files without an explicit instruction.
- `tech_debt.md` is managed by the user: update it only when told to (check off, discard, or add items).

## 7. Code: the user decides
- Never fix issues on your own initiative. Propose → plan → approval → implement only what was agreed.
- Keep changes small and scoped to one topic so the user can review and commit them separately.
- When a change is done, state honestly what was verified (tests, browser) and what wasn't.

## 8. Nothing outward-facing
- Never send emails, open issues, or publish anything related to the submission.
