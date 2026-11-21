# APDT — Autonomous Product Development Team

Local-first CLI that initializes software repositories into structured, harness-independent AI product development workspaces.

APDT installs shared project knowledge, organization config, workflows/skills, and adapters for **Cursor**, **Claude Code**, and **OpenAI Codex**. It is not an AI coding runtime.

## Install

```bash
npm install -g apdt
# or one-shot:
npx apdt init --yes /path/to/project
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

## What `init` installs

- Shared knowledge under `apdt/`
- Core-owned thin `AGENTS.md`
- Shared skills under `.agents/skills/`
- Cursor: `.cursor/rules` + `.cursor/agents` when selected
- Claude Code: `CLAUDE.md`, `.claude/agents`, skill mirrors under `.claude/skills/` when selected
- Codex: `.codex/agents/*.toml` when selected
- Inventory at `apdt/.apdt-manifest.yaml`
- Onboarding at `apdt/ONBOARDING.md`

APDT does not write `.claude/settings.json` or `.codex/config.toml`.

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
