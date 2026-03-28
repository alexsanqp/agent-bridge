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
Tools layer (peer_send, peer_reply, peer_inbox, ...)
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
It also creates `AGENTS.md` with role prompts so each agent knows how to
use the collaboration tools.
