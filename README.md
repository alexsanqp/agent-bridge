# Agent Bridge

A shared task bus for coding agents.
Make Cursor, Claude Code, and Codex work together in one repo through a shared local SQLite workspace — no daemon, no HTTP server, no ports.

## How It Works

```
Cursor agent:  "Review my auth module changes"
                    | peer_send
              +---------------+
              |  Agent Bridge |  <-- shared SQLite, no daemon
              +---------------+
                    | peer_inbox
Claude agent:  "Found 3 issues..."
```

Each client launches its own MCP server process via stdio. All processes read and write the same SQLite database in WAL mode. No daemon, no HTTP server, no port management.

- Cursor opens -- starts MCP process -- reads `bridge.db`
- Claude Code opens -- starts MCP process -- reads same `bridge.db`
- Codex CLI opens -- starts MCP process -- reads same `bridge.db`

SQLite WAL mode allows concurrent readers without blocking. Writes are serialized with `busy_timeout` -- this is safe because writes are rare (units per minute). Closing one client does not affect the others.

## Install

### npm (recommended, all platforms)

```bash
npm install -g @plus-minus/agent-bridge
```

### macOS / Linux (without Node)

```bash
curl -fsSL https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.sh | bash
```

Downloads a pre-built binary from GitHub Releases to `~/.agent-bridge/bin/`.

### Windows (without Node)

```powershell
irm https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.ps1 | iex
```

Downloads a pre-built binary from GitHub Releases.

## Quick Start

```bash
cd your-project
agent-bridge init
```

This will:

1. Find your project root (looks for `.git`, `package.json`, etc.)
2. Detect installed clients (Cursor, Claude Code, Codex CLI)
3. Prompt for agent names and roles for each detected client
4. Generate MCP configs for each detected client
5. Write a unified `SKILL.md` for peer collaboration (in `.agents/skills/` and `.claude/skills/`)
6. Append a minimal pointer to `CLAUDE.md` (not full instructions)
7. Initialize the SQLite database and register agents
8. Update `.gitignore` to exclude runtime data

Open your editors -- agents will see each other automatically.

## Autonomy Mode

Agent Bridge supports two collaboration modes, configured in `.agent-bridge/config.yaml`:

```yaml
autonomy:
  mode: manual     # or "autonomous"
```

**Manual mode (default):** Agents use collaboration tools only when the user explicitly asks. The user drives the workflow -- "send this to X", "check my inbox", etc.

**Autonomous mode:** Agents proactively check their inbox on session start and poll for responses using `peer_check`. They process incoming tasks without waiting for user instructions.

> **Note:** Autonomous mode is experimental and may not work reliably with all clients yet. The behavior depends on how well each AI client follows the SKILL.md instructions for proactive inbox checking and polling. Use manual mode for production workflows.

Set the mode during init with `--mode`:

```bash
agent-bridge init --mode autonomous
agent-bridge init --mode manual        # default
```

Or edit `.agent-bridge/config.yaml` and run `agent-bridge init --force` to regenerate instruction files. The init command preserves your mode setting across re-runs.

## Usage

### Step 1: Activate each agent

Open each AI client (Cursor, Claude Code, Codex) and send:

```
/peer-collaborate
```

The agent calls `peer_status`, registers itself as online, and sees which peers are available. Agents are considered online if active within the last 5 minutes.

### Step 2: Give tasks

**Manual mode** -- you tell the agent what to do:

```
=== In Cursor ===
You: "Review the auth module and send feedback to agent-claude"

Cursor calls:
  peer_send(to="agent-claude", task_type="review",
            summary="Review auth module", body="Check for XSS in login flow")
  --> { task_id: "a1b2c3", status: "pending" }
```

```
=== In Claude Code ===
You: "Check your inbox"

Claude calls:
  peer_inbox()  --> [{ sender: "agent-cursor", summary: "Review auth module" }]
  peer_get_task("a1b2c3")  --> full task with code
  ... does the review ...
  peer_reply("a1b2c3", body="Found XSS in line 42: unsanitized innerHTML")
```

```
=== Back in Cursor ===
You: "Check if claude replied"

Cursor calls:
  peer_check("a1b2c3")  --> { new_message_count: 1 }
  peer_get_task("a1b2c3")  --> reads the review
  peer_complete("a1b2c3")
```

**Autonomous mode** -- agents act proactively:

Each agent checks `peer_inbox` on session start, processes incoming tasks without prompting, and uses `peer_check` to poll for responses instead of blocking with `peer_wait`.

Use `peer_check` instead of `peer_wait` in both modes. `peer_wait` blocks the MCP connection and may timeout on clients like Cursor (30-200s limit). `peer_check` returns immediately.

See [Getting Started](docs/getting-started.md) for detailed walkthroughs.

## Roles

Roles are configurable labels, not tied to specific clients. During `agent-bridge init`, each agent is assigned a role (developer, reviewer, tester, architect, or any custom string). Roles appear in instruction files and help agents understand their responsibilities, but do not restrict tool access.

Edit the `agents` section in `.agent-bridge/config.yaml` to change roles:

```yaml
agents:
  - name: cursor-dev
    role: developer
    client: cursor
    enabled: true
  - name: claude-reviewer
    role: reviewer
    client: claude-code
    enabled: true
```

Set `enabled: false` to disable an agent without removing it from the config. Disabled agents are excluded from instruction generation and peer lists. Re-enable by setting `enabled: true` and running `agent-bridge init`.

After editing, run `agent-bridge init --force` to regenerate instruction files with the updated roles.

## CLI Commands

| Command | Description |
|---------|-------------|
| `agent-bridge init` | Set up project bridge structure, detect clients, generate MCP configs and skill files |
| `agent-bridge init --force` | Overwrite existing configs |
| `agent-bridge init --no-detect` | Skip client auto-detection, prompt for all |
| `agent-bridge init --mode <mode>` | Set collaboration mode: `manual` (default) or `autonomous` |
| `agent-bridge doctor` | Diagnose setup: check configs, database access, binary paths, version |
| `agent-bridge status` | Show active tasks, pending inbox per agent, last activity, known agents |
| `agent-bridge tasks` | List all tasks |
| `agent-bridge tasks --status pending` | Filter tasks by status |
| `agent-bridge tasks --agent cursor-dev` | Filter tasks by agent |
| `agent-bridge reset` | Clear expired and cancelled tasks |
| `agent-bridge reset --hard` | Delete `bridge.db` and artifacts (fresh start) |
| `agent-bridge self-update` | Check GitHub releases, download new version if available |
| `agent-bridge version` | Print current version |

## Supported Clients

| Client | MCP Transport | Config Format | Config Location | Platform |
|--------|--------------|---------------|-----------------|----------|
| Cursor | stdio | JSON | `.cursor/mcp.json` | macOS, Linux, Windows |
| Claude Code | stdio | JSON | `.mcp.json` | macOS, Linux |
| Codex CLI | stdio | TOML | `.codex/config.toml` | macOS, Linux, Windows (experimental) |

All three clients launch a command and communicate via stdin/stdout. This is the only transport Agent Bridge uses.

## Project Structure

After running `agent-bridge init`, the following structure is created:

```
your-project/
  .agent-bridge/
    config.yaml           # project configuration (committed)
    bridge.db             # SQLite database (gitignored)
    artifacts/            # task attachments (gitignored)
    logs/                 # bridge logs (gitignored)
  .cursor/
    mcp.json              # Cursor MCP config
  .mcp.json               # Claude Code MCP config
  .codex/
    config.toml           # Codex CLI MCP config
  .agents/
    skills/
      peer-collaborate/
        SKILL.md          # unified peer collaboration instructions (all clients)
  .claude/
    skills/
      peer-collaborate/
        SKILL.md          # symlink / copy for Claude Code skill discovery
  CLAUDE.md               # minimal pointer to SKILL.md (Agent Bridge section appended)
  AGENTS.md               # shared collaboration rules (Codex reads this natively)
```

MCP configs contain absolute paths to the binary and bridge directory. They are regenerated with correct local paths on `agent-bridge init` after cloning.

Agent instructions are delivered via a unified `SKILL.md` file placed in skill discovery paths:
- `.agents/skills/peer-collaborate/SKILL.md` -- primary location (Cursor discovers skills here)
- `.claude/skills/peer-collaborate/SKILL.md` -- Claude Code skill discovery path
- `CLAUDE.md` receives a minimal pointer to the skill, not full instructions
- `AGENTS.md` -- Codex reads this file natively for collaboration rules

This replaces the previous approach of per-client instruction files (`.cursor/rules/agent-bridge.mdc`, individual `.agents/*.md` prompts). Agent identity is now resolved from `peer_status` at runtime, not hardcoded in prompt files.

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `peer_send` | Create a new task addressed to another agent |
| `peer_reply` | Reply to a task addressed to this agent |
| `peer_inbox` | List tasks assigned to this agent |
| `peer_get_task` | Get full task details with messages and artifacts |
| `peer_wait` | Block until a reply arrives or timeout (polls every 1s) |
| `peer_check` | Quick non-blocking check for new activity on a task |
| `peer_complete` | Mark a task as completed |
| `peer_cancel` | Cancel a task with an optional reason |
| `peer_status` | Get bridge status, agent info, and known agents |

See [Tools Reference](docs/tools-reference.md) for full parameter details and error codes.

## Documentation

- [Getting Started](docs/getting-started.md) -- first steps and activation flow
- [Setup Guide](docs/setup-guide.md) -- detailed installation and configuration
- [Tools Reference](docs/tools-reference.md) -- MCP tools parameter details and examples
- [Architecture](docs/architecture.md) -- design decisions and internals
- [Troubleshooting](docs/troubleshooting.md) -- common issues and solutions

## Development

Requires Node.js >= 18.

```bash
# Install dependencies
npm install

# Build
npm run build

# Run from source
npm run dev -- <command>

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type-check without emitting
npm run lint
```

## License

MIT
