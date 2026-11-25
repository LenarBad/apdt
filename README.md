# APDT — Autonomous Product Development Team

Local-first CLI that initializes software repositories into structured, harness-independent AI product development workspaces.

APDT installs shared project knowledge, organization config, workflows/skills, and adapters for **Cursor**, **Claude Code**, and **OpenAI Codex**. It is not an AI coding runtime.

## Install

```bash
npm install -g @lenarbad/apdt
apdt init --yes /path/to/project
```

Requires Node.js 20+.

## Quick start

```bash
# Analyze a repo (read-only)
apdt analyze .

# Non-interactive init (default harness: Cursor)
apdt init --yes .

# Validate the install
apdt doctor .
apdt status .
```

Interactive `init` (no `--yes`) prompts for harnesses, preset, and autonomy when a terminal is available.

## Commands

```bash
apdt analyze [path] [--json]
apdt init [path] [--yes] [--force] [--recompose] [--harness cursor,claude-code,codex] [--preset minimal|standard|full-stack-split] [--autonomy supervised]
apdt update [path] [--force] [--recompose] [--harness ...] [--preset ...] [--autonomy ...]
apdt export [path] [--out dir]
apdt doctor [path] [--strict]
apdt status [path]
apdt team [path]
```

**Presets:** `minimal` (default for greenfield/early), `standard`, `full-stack-split`.

**Brownfield:** existing `apdt/**` files are adopted into the manifest without overwrite (`pinContent`). Invalid organization YAML is repaired with backup. Harness-file collisions outside `apdt/` are skipped. `--recompose` rebuilds the team from the preset.

## Upgrade an existing project

Install the newer CLI, then refresh the project:

```bash
npm install -g @lenarbad/apdt
apdt update .
```

`apdt update` keeps the installed team. It rewrites a managed file only when the new template differs and the file still matches the last install. Files you edited, `pinContent` files, and anything outside the manifest stay as they are. `--force` overwrites edited managed files after a backup.

Team and ownership changes ship in the composer, not in the template text. Those land only with `apdt update --recompose`, which rebuilds the team from the installed preset. Edited and pinned files are still left alone.

## What `init` installs

- Shared knowledge under `apdt/`
- Core-owned thin `AGENTS.md`
- Shared skills under `.agents/skills/`
- Cursor: `.cursor/rules` + `.cursor/agents` when selected
- Claude Code: `CLAUDE.md`, `.claude/agents`, skill mirrors under `.claude/skills/` when selected
- Codex: `.codex/agents/*.toml` when selected
- Inventory at `apdt/.apdt-manifest.yaml`
- Onboarding at `apdt/ONBOARDING.md`

APDT does not write `.codex/config.toml`. It does not write `.claude/settings.json` unless you opt in to the Claude Code usage guard (`harnesses.claudeCode.usageGuard.enabled` in `apdt/organization/team.yaml`). When enabled, APDT installs hooks that pause work and block subagent spawning around 90% plan usage, then resume after reset (subscription sessions only; ADR 008).

## Development

```bash
git clone https://github.com/LenarBad/apdt.git
cd apdt
npm install
npm test
npm run build
node dist/cli.js --help
```

Tests write under `tests/.tmp/` and may need a non-sandboxed environment.

## License

MIT
