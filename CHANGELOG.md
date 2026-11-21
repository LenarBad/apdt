# Changelog

## 0.1.0 — 2026-11-21

Initial public release as `@lenarbad/apdt` (unscoped `apdt` blocked by npm name similarity rules). CLI binary remains `apdt`.

- CLI: `analyze`, `init`, `update`, `export`, `doctor`, `status`, `team`
- Harness adapters: Cursor, Claude Code, Codex
- Brownfield-safe apply (dirty detection, backups, `pinContent` adopt)
- Continuity readback via `status` / `team`
- Evaluation triage detection in `doctor` / `status`
- Template migrations framework and orphan harness-agent cleanup on recompose
