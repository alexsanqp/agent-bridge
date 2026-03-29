# Architecture

## Overview

Agent Bridge enables peer-to-peer collaboration between AI coding agents
(Cursor, Claude Code, Codex CLI) within a single project. It uses a
shared-nothing MCP architecture with a local SQLite database as the
coordination layer.

## Why MCP stdio (no daemon)

Each agent client spawns its own `agent-bridge mcp-server` process via MCP
stdio transport. There is no long-running daemon or background service.

Benefits of this approach:

- **Zero infrastructure:** No ports, no sockets, no process manager. The
  client starts and stops the server automatically.
- **Crash isolation:** If one agent's MCP process crashes, others are
  unaffected. The next tool call spawns a fresh process.
- **Cross-platform:** stdio works identically on macOS, Linux, and Windows
  without platform-specific IPC.

## Why SQLite WAL

All MCP server processes read and write the same `.agent-bridge/bridge.db`
file using SQLite in WAL (Write-Ahead Logging) mode.

- **Concurrent reads:** Multiple agents can query tasks and messages
  simultaneously without blocking each other.
- **Serialized writes:** SQLite guarantees single-writer consistency, which
  is sufficient for the low write throughput of agent collaboration.
- **No external dependencies:** No Redis, no Postgres, no message broker.
  The database is a single file that travels with the project.

## Layering

```
CLI commands (init, doctor, status, tasks, reset)
        |
MCP Server (stdio transport)
        |
Tools layer (peer_send, peer_reply, peer_inbox, peer_check, ...)
        |
Domain layer (models, status FSM, error codes, policies)
        |
Store layer (SQLite via better-sqlite3: tasks, messages, artifacts, agents)
        |
Utils (paths, IDs, time)
```

- **Tools** handle MCP request/response serialization and input validation.
- **Domain** contains pure business logic: task status transitions, security
  policies (blocked patterns, size limits, path boundaries), and error types.
- **Store** owns all database access. Each entity (tasks, messages, artifacts,
  agents) has its own module.

## Autonomy mode

Agent Bridge supports two collaboration modes: **manual** and **autonomous**. The mode is set in `.agent-bridge/config.yaml` and affects the workflow instructions generated for each agent.

### Manual mode

Agents use peer tools only when the user explicitly requests it. The generated instruction files tell agents to wait for user commands like "check inbox" or "send to X". This is the default and works well for supervised workflows.

### Autonomous mode

Agents proactively participate in collaboration:
- Call `peer_inbox` on session start to process pending tasks
- Use `peer_check` to poll for responses instead of blocking with `peer_wait`
- Continue working while waiting for replies

Autonomous mode exists because real multi-agent workflows require agents to operate independently across separate editor windows. Waiting for the user to manually trigger each inbox check or send operation defeats the purpose of having multiple agents.

### Why peer_check exists

The `peer_wait` tool blocks the MCP connection until a reply arrives or the timeout is reached. This works in theory but fails in practice on several clients:

- **Cursor** enforces MCP tool call timeouts of roughly 30-200 seconds. A `peer_wait` call with `timeout_seconds=300` will be killed by Cursor before it can return a result.
- **Claude Code** handles long-running MCP calls more gracefully, but blocking still prevents the agent from doing useful work while waiting.

`peer_check` solves this by returning immediately with a count of new messages and the current task status. The agent can call it periodically, continuing other work between checks. This pattern is reliable across all clients and is the recommended approach in autonomous mode.

## Unified SKILL.md instruction delivery

As of v0.3.0, agent instructions are delivered via a single unified `SKILL.md` file instead of per-client instruction files. This file contains all collaboration instructions: peer tool usage, workflow rules for the configured autonomy mode, and peer agent list.

### Skill discovery paths

Each client discovers skills from a different directory:

| Client | Skill path | Discovery mechanism |
|--------|-----------|---------------------|
| Cursor | `.agents/skills/peer-collaborate/SKILL.md` | Cursor discovers skills from `.agents/skills/` |
| Claude Code | `.claude/skills/peer-collaborate/SKILL.md` | Claude Code discovers skills from `.claude/skills/` |
| Codex CLI | `AGENTS.md` | Codex reads this file natively |

Both `SKILL.md` files contain the same content. `CLAUDE.md` receives only a minimal pointer directing the agent to the skill -- it no longer contains the full instruction block.

### Agent identity at runtime

Agent identity (name, role, peers) is resolved dynamically via `peer_status` rather than being hardcoded into prompt files. This decouples the instruction content from specific agent configurations and makes the skill truly reusable.

### Legacy files

The previous per-client files (`.cursor/rules/agent-bridge.mdc`, individual `.agents/<name>.md` prompts) are no longer generated. Existing `.cursor/rules/agent-bridge.mdc` files are cleaned up automatically on re-init.

## Security policies

Artifact transfers are governed by configurable policies in
`.agent-bridge/config.yaml`:

- **Blocked patterns:** Glob patterns for files that must never be shared
  (e.g., `.env`, `*.pem`, `credentials.json`).
- **Size limits:** Maximum artifact size in KB to prevent accidental large
  file transfers.
- **Path boundary:** Artifacts must reside within the project root. Symlinks
  and `../` traversals outside the boundary are rejected.

## Client detection and config generation

`agent-bridge init` detects installed clients by checking for known config
directories and generates the appropriate MCP configuration for each one.
During init, roles are assigned per agent through interactive prompts -- they
are not predetermined by the client type. A Cursor agent can be a reviewer
and a Claude Code agent can be a developer.

The init command also preserves the autonomy mode from the existing
`config.yaml` when re-running, so switching modes requires only a config
edit followed by `agent-bridge init`.
