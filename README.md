# Agent Bridge

Peer collaboration bridge for AI coding agents.
Allows Cursor, Claude Code, and Codex CLI to exchange tasks, messages, and artifacts within a shared project.

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
5. Write client-specific instruction files (`.cursor/rules/agent-bridge.mdc`, `CLAUDE.md`, `AGENTS.md`)
6. Create role prompts in `.agents/`
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

**Autonomous mode:** Agents proactively check their inbox on session start and poll for responses using `peer_check`. They process incoming tasks without waiting for user instructions. This is the recommended mode for multi-agent workflows where agents run in separate editor windows.

To switch modes, edit `.agent-bridge/config.yaml` and run `agent-bridge init` again to regenerate instruction files. The init command preserves your mode setting across re-runs.

## Usage

### Manual Mode Workflow

The user drives all collaboration:

```
User: "Send a review request to claude-reviewer"
Agent: peer_send(to="claude-reviewer", task_type="review", summary="Review auth module", body="...")
Agent: peer_wait(task_id="a1b2c3", timeout_seconds=120)
       --> blocks until reply or timeout
Agent: "Claude found 3 issues: ..."
```

### Autonomous Mode Workflow

Agents collaborate proactively:

```
# Agent checks inbox on session start
peer_inbox() --> [{ id: "a1b2c3", sender: "cursor-dev", summary: "Review auth module" }]

# Agent reads and processes the task
peer_get_task(task_id="a1b2c3") --> full task details
# ... does the review work ...
peer_reply(task_id="a1b2c3", body="Found 3 issues: ...")

# Sending agent polls for the response (no blocking wait)
peer_check(task_id="a1b2c3") --> { new_message_count: 1, status: "active" }
peer_get_task(task_id="a1b2c3") --> reads the full reply
peer_complete(task_id="a1b2c3")
```

Use `peer_check` instead of `peer_wait` in autonomous mode. `peer_wait` blocks the MCP connection and may timeout on clients like Cursor (which enforce 30-200s MCP call limits). `peer_check` returns immediately and lets the agent continue working while waiting.

## Roles

Roles are configurable labels, not tied to specific clients. During `agent-bridge init`, each agent is assigned a role (developer, reviewer, tester, architect, or any custom string). Roles appear in instruction files and help agents understand their responsibilities, but do not restrict tool access.

Edit the `agents` section in `.agent-bridge/config.yaml` to change roles:

```yaml
agents:
  - name: cursor-dev
    role: developer
    client: cursor
  - name: claude-reviewer
    role: reviewer
    client: claude-code
```

After editing, run `agent-bridge init --force` to regenerate instruction files with the updated roles.

## CLI Commands

| Command | Description |
|---------|-------------|
| `agent-bridge init` | Set up project bridge structure, detect clients, generate MCP configs and role prompts |
| `agent-bridge init --force` | Overwrite existing configs |
| `agent-bridge init --no-detect` | Skip client auto-detection, prompt for all |
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
    rules/
      agent-bridge.mdc    # Cursor agent instructions (auto-applied rule)
  .mcp.json               # Claude Code MCP config
  .codex/
    config.toml           # Codex CLI MCP config
  .agents/
    cursor-dev.md         # role prompt for Cursor agent
    claude-reviewer.md    # role prompt for Claude agent
    codex-tester.md       # role prompt for Codex agent
  CLAUDE.md               # Claude Code agent instructions (Agent Bridge section appended)
  AGENTS.md               # shared collaboration rules (Codex reads this natively)
```

MCP configs contain absolute paths to the binary and bridge directory. They are regenerated with correct local paths on `agent-bridge init` after cloning.

Client-specific instruction files are generated per client type:
- **Cursor:** `.cursor/rules/agent-bridge.mdc` -- an always-applied MDC rule
- **Claude Code:** `CLAUDE.md` -- Agent Bridge section is appended or replaced
- **Codex CLI:** `AGENTS.md` -- Codex reads this file natively

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

- [Technical Specification](SPEC.md) -- full architecture, data model, API reference
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

## Status

V1 in development. See [SPEC.md](SPEC.md) for the full specification.

## License

MIT
