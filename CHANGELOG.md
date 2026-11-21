# Changelog

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
