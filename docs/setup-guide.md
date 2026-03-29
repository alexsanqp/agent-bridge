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
- Role prompts in `.agents/<agent-name>.md`
- Client-specific instruction files (see below)
- `AGENTS.md` with shared collaboration rules
- SQLite database schema at `.agent-bridge/bridge.db`
- `.gitignore` entries for runtime data

## Client-specific instruction files

Each client type receives instructions in the format it reads natively:

| Client | File | How it works |
|--------|------|--------------|
| Cursor | `.cursor/rules/agent-bridge.mdc` | MDC rule with `alwaysApply: true` -- Cursor loads it automatically on every session |
| Claude Code | `CLAUDE.md` | Agent Bridge section is appended (or replaced if already present). Claude Code reads this file as project instructions |
| Codex CLI | `AGENTS.md` | Codex reads this file natively for agent collaboration rules |

These files contain the agent's name, role, list of peer agents, available tools, and workflow instructions matching the configured autonomy mode.

## Manual vs autonomous mode

Agent Bridge supports two collaboration modes:

**Manual (default):** Agents only use peer tools when the user explicitly asks. Good for getting started or when you want full control over inter-agent communication.

**Autonomous:** Agents proactively check their inbox on session start, process incoming tasks without user prompting, and poll for responses using `peer_check` instead of blocking with `peer_wait`. Recommended for multi-agent workflows where agents run in parallel across separate editor windows.

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

## Changing agent roles

To change an agent's role after init:

1. Edit the `agents` section in `.agent-bridge/config.yaml`
2. Run `agent-bridge init --force` to regenerate all instruction and role files
3. Restart your AI client sessions
