# Changelog

## 0.1.6 — 2026-11-27

`apdt uninstall` removes an install from a project. Template schema stays `0.2.0`.

- Deletes files recorded in `apdt/.apdt-manifest.yaml`, later notes under `apdt/`, and the manifest. Copies them to `.apdt-backup/<timestamp>/` first.
- Leaves files the install adopted with `pinContent`, and leaves anything the manifest does not list: other rules, other skills, a pre-existing `AGENTS.md`.
- When `.claude/settings.json` has other settings, removes only the `apdt-usage-guard` hooks. A settings file that contains only the guard is deleted.
- Refuses to run without a terminal confirmation or `--yes`. `--dry-run` prints the plan and changes nothing.

## 0.1.5 — 2026-11-26

The Claude Code usage guard pauses the current turn from Claude's own usage reading, and `session-start` warns when the working tree is not git. Template schema stays `0.2.0`.

- A project status line records `rate_limits`. At or above 90%, the hook stops the turn before the next user message and before every tool call of the main agent and any subagent. A text-only reply is not checked.
- On macOS the fallback reads the login keychain item `Claude Code-credentials`. The `0.1.4` hook only read `~/.claude/.credentials.json`, which is absent there, so it failed open.
- `session-start` warns that review and rollback need git, then continues. Review still prefers a git diff.
- Existing Claude Code installs pick this up on the next `apdt update` after upgrading the CLI.

## 0.1.4 — 2026-11-25

Claude Code usage guard is **on by default** when Claude Code is enabled. Template schema stays `0.2.0`.

- `apdt init` / `apdt update` write `harnesses.claudeCode.usageGuard` and install the hooks automatically.
- Set `harnesses.claudeCode.usageGuard.enabled: false` to disable.
- Existing Claude Code installs pick this up on the next `apdt update` after upgrading the CLI.

## 0.1.3 — 2026-11-25

Optional Claude Code usage guard. Template schema stays `0.2.0`. Off by default in this release.

- Opt in with `harnesses.claudeCode.usageGuard.enabled` in `apdt/organization/team.yaml`, then `apdt update`.
- When enabled, APDT installs hooks that pause work and block Agent/Task/Workflow spawning around 90% plan usage, then resume after reset. Writes managed `.claude/settings.json` only for that feature (ADR 008).

## 0.1.2 — 2026-11-24

Specialist ownership and a review contract for generated agents. Template schema stays `0.2.0`. An existing install keeps its team until `apdt update --recompose`.

- Emitted specialists own `backend-implementation`, `frontend-implementation`, and `security-review`. When `reviewer` is emitted, that agent owns `code-review`. `minimal` still leaves `code-review` with `qa`.
- `review-change` delegates to the readonly `code-review` owner with acceptance criteria and a diff, writes `apdt/quality/reviews/…`, and returns a short summary. `evaluate-product` delegates to the readonly `independent-evaluation` owner. Evaluations stay under `apdt/product/evaluations/`.
- Cursor, Claude Code, and Codex agent bodies include the profile inputs and outputs.
- `apdt update` rewrites a clean managed file when its template changed, and leaves edited, pinned, unchanged, and unmanaged files alone.

## 0.1.1 — 2026-11-21

First installable registry release. `0.1.0` was accepted by npm into a non-visible staged state (E409 on republish); bumped to clear the block.

## 0.1.0 — 2026-11-21

Initial public release attempt as `@lenarbad/apdt` (unscoped `apdt` blocked by npm name similarity rules). CLI binary remains `apdt`. Not installable from the registry; use `0.1.1`.

- CLI: `analyze`, `init`, `update`, `export`, `doctor`, `status`, `team`
- Harness adapters: Cursor, Claude Code, Codex
- Brownfield-safe apply (dirty detection, backups, `pinContent` adopt)
- Continuity readback via `status` / `team`
- Evaluation triage detection in `doctor` / `status`
- Template migrations framework and orphan harness-agent cleanup on recompose
