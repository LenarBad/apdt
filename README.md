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
apdt uninstall [path] [--yes] [--dry-run]
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

## Uninstall from a project

```bash
apdt uninstall . --dry-run
apdt uninstall . --yes
```

This removes the files APDT installed, notes written later under `apdt/`, and the manifest. It copies them to `.apdt-backup/<timestamp>/` first. Files adopted with `pinContent` stay, because those bytes were already in the project. Other rules, other skills, a pre-existing `AGENTS.md`, and `.codex/config.toml` stay. If `.claude/settings.json` has settings besides the usage guard, only the `apdt-usage-guard` hooks are removed.

Without a terminal, pass `--yes`. `--dry-run` prints the plan and writes nothing.

Remove the command from the machine separately:

```bash
npm uninstall -g @lenarbad/apdt
```

## What `init` installs

- Shared knowledge under `apdt/`
- Core-owned thin `AGENTS.md`
- Shared skills under `.agents/skills/`
- Cursor: `.cursor/rules` + `.cursor/agents` when selected
- Claude Code: `CLAUDE.md`, `.claude/agents`, skill mirrors under `.claude/skills/` when selected
- Codex: `.codex/agents/*.toml` when selected
- Inventory at `apdt/.apdt-manifest.yaml`
- Onboarding at `apdt/ONBOARDING.md`

APDT does not write `.codex/config.toml`. When Claude Code is enabled, APDT turns on a usage guard by default and writes managed `.claude/settings.json` hooks that stop the current turn around 90% plan usage, then resume after reset (subscription sessions only; ADR 008). On macOS the hook reads the Claude Code login from the Keychain. Set `harnesses.claudeCode.usageGuard.enabled: false` to disable.

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
