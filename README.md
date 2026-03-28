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
3. Generate MCP configs for each detected client
4. Create role prompts in `.agents/`
5. Generate `AGENTS.md` with shared collaboration rules
6. Initialize the SQLite database
7. Update `.gitignore` to exclude runtime data

Open your editors -- agents will see each other automatically.

## Usage

Agents communicate through 8 MCP tools. Here is a typical workflow:

**Send a task to another agent:**

```
peer_send(
  to="claude-reviewer",
  task_type="review",
  summary="Review auth module changes",
  body="Please review src/auth/ for security issues. Focus on token validation."
)
--> { task_id: "a1b2c3", status: "pending" }
```

**Wait for a reply (blocks until response or timeout):**

```
peer_wait(task_id="a1b2c3", timeout_seconds=120)
--> { status: "reply_received", new_messages: [...] }
```

**Check your inbox for incoming tasks:**

```
peer_inbox()
--> { tasks: [{ id: "a1b2c3", sender: "cursor-dev", summary: "Review auth module changes", ... }] }
```

**Reply to a task assigned to you:**

```
peer_reply(
  task_id="a1b2c3",
  body="Found 3 issues:\n1. Token expiry not checked in refresh flow\n2. Missing rate limit on /login\n3. CSRF token not rotated on auth state change"
)
```

**Mark a task as done:**

```
peer_complete(task_id="a1b2c3")
--> { status: "completed" }
```

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
  .mcp.json               # Claude Code MCP config
  .codex/
    config.toml           # Codex CLI MCP config
  .agents/
    cursor-dev.md         # role prompt for Cursor agent
    claude-reviewer.md    # role prompt for Claude agent
    codex-tester.md       # role prompt for Codex agent
  AGENTS.md               # shared collaboration rules
```

MCP configs contain absolute paths to the binary and bridge directory. They are regenerated with correct local paths on `agent-bridge init` after cloning.

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `peer_send` | Create a new task addressed to another agent |
| `peer_reply` | Reply to a task addressed to this agent |
| `peer_inbox` | List tasks assigned to this agent |
| `peer_get_task` | Get full task details with messages and artifacts |
| `peer_wait` | Block until a reply arrives or timeout (polls every 1s) |
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
