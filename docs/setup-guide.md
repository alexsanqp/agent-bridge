# Setup Guide

## Prerequisites

- Node.js >= 18
- One or more supported AI clients: Cursor, Claude Code, or Codex CLI

## Install

**npm (recommended, all platforms):**

```bash
npm install -g @plus-minus/agent-bridge
```

**macOS / Linux (curl):**

```bash
curl -fsSL https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.ps1 | iex
```

**From source:**

```bash
git clone https://github.com/alexsanqp/agent-bridge.git
cd agent-bridge
npm install && npm run build
npm link
```

## Initialize a project

Run `agent-bridge init` from your project root. The init flow works as follows:

### 1. Client detection

The CLI scans for known client config directories to determine which AI editors are installed:
- **Cursor:** checks for `.cursor/` directory or Cursor-specific markers
- **Claude Code:** checks for Claude Code indicators
- **Codex CLI:** checks for `.codex/` directory

During first init, you will be prompted to confirm each detected client (e.g., "Enable cursor? [Y/n]"). Declining sets `enabled: false` for that agent in `config.yaml` -- the agent is preserved in the config but excluded from instruction generation.

Skip detection with `--no-detect` to enter agents manually. Set the collaboration mode with `--mode`:

```bash
agent-bridge init --mode autonomous    # autonomous mode from the start
agent-bridge init --mode manual        # explicit manual (default)
```

### 2. Agent naming

For each detected client, the CLI prompts for an agent name (e.g., `cursor-dev`, `claude-reviewer`). These names are used as identifiers in `peer_send(to=...)` and `peer_inbox()`. They must be unique within the project.

### 3. Role assignment

Each agent gets a role label: `developer`, `reviewer`, `tester`, `architect`, or any custom string. Roles are not tied to clients -- a Cursor agent can be a reviewer and a Claude Code agent can be a developer. Roles appear in generated instruction files and help agents understand their responsibilities.

### 4. Config and file generation

The init command generates:

- `.agent-bridge/config.yaml` -- central config with agents, policies, and autonomy mode
- MCP configs for each client (`.cursor/mcp.json`, `.mcp.json`, `.codex/config.toml`)
- `.agents/skills/peer-collaborate/SKILL.md` -- unified peer collaboration instructions
- `.claude/skills/peer-collaborate/SKILL.md` -- Claude Code skill discovery path
- `CLAUDE.md` -- minimal pointer to the skill (appended or replaced)
- `AGENTS.md` with shared collaboration rules
- SQLite database schema at `.agent-bridge/bridge.db`
- `.gitignore` entries for runtime data

## Skill-based instruction delivery

As of v0.3.0, agent instructions are delivered via a unified `SKILL.md` file rather than per-client instruction files. The skill is placed in discovery paths for each client:

| Client | Skill discovery path | Additional |
|--------|---------------------|------------|
| Cursor | `.agents/skills/peer-collaborate/SKILL.md` | Cursor discovers skills from `.agents/skills/` |
| Claude Code | `.claude/skills/peer-collaborate/SKILL.md` | Claude Code discovers skills from `.claude/skills/` |
| Codex CLI | `AGENTS.md` | Codex reads this file natively |

`CLAUDE.md` receives a minimal pointer directing Claude Code to the skill, not the full instructions. Agent identity is resolved at runtime via `peer_status`, not hardcoded in prompt files.

The previous per-client files (`.cursor/rules/agent-bridge.mdc`, `.agents/<name>.md`) are no longer generated. Existing `.cursor/rules/agent-bridge.mdc` files are cleaned up on re-init.

## Manual vs autonomous mode

Agent Bridge supports two collaboration modes:

**Manual (default):** Agents only use peer tools when the user explicitly asks. Good for getting started or when you want full control over inter-agent communication.

**Autonomous:** Agents proactively check their inbox on session start, process incoming tasks without user prompting, and poll for responses using `peer_check` instead of blocking with `peer_wait`.

> **Note:** Autonomous mode is experimental and may not work reliably with all clients yet. The behavior depends on how well each AI client follows the SKILL.md instructions for proactive inbox checking and polling. Use manual mode for production workflows.

The mode is set in `.agent-bridge/config.yaml`:

```yaml
autonomy:
  mode: manual     # or "autonomous"
```

### Switching modes

**Option 1 — during init:**

```bash
agent-bridge init --force --mode autonomous
```

**Option 2 — edit config:**

1. Edit `.agent-bridge/config.yaml` and change `autonomy.mode` to `manual` or `autonomous`
2. Run `agent-bridge init --force` to regenerate instruction files
3. Restart your AI client sessions

The `--mode` flag takes priority over the existing config. Without `--mode`, init preserves the current setting.

## Verify the setup

```bash
agent-bridge doctor    # Check config, database, and client connectivity
agent-bridge status    # Show active agents, tasks, and inbox
```

## Day-to-day usage

Once initialized, each AI agent session automatically connects to the bridge
via its MCP stdio server. Agents use `peer_send`, `peer_reply`, `peer_check`,
and other tools to collaborate through the shared task database.

```bash
agent-bridge tasks             # List all tasks
agent-bridge tasks --status pending  # Filter by status
agent-bridge reset             # Clear expired and cancelled tasks
```

## Enabling and disabling agents

Each agent in `config.yaml` has an `enabled` flag:

```yaml
agents:
  - name: cursor-dev
    role: developer
    client: cursor
    enabled: true
  - name: claude-reviewer
    role: reviewer
    client: claude-code
    enabled: false    # excluded from instruction generation and peer lists
```

To disable an agent, set `enabled: false` and run `agent-bridge init`. To re-enable, set `enabled: true` and run `agent-bridge init` again. The agent's config is preserved either way.

## Re-init behavior

Running `agent-bridge init` without `--force` reads the existing `config.yaml` and preserves agents, roles, and settings. This means:

- Adding a new client does not reset existing agents
- Changing a role in `config.yaml` and re-running init regenerates instruction files
- Use `--force` to overwrite configs and go through the full interactive setup again

## Changing agent roles

To change an agent's role after init:

1. Edit the `agents` section in `.agent-bridge/config.yaml`
2. Run `agent-bridge init --force` to regenerate all instruction and role files
3. Restart your AI client sessions
