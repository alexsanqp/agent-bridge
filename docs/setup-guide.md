# Setup Guide

## Prerequisites

- Node.js >= 18
- One or more supported AI clients: Cursor, Claude Code, or Codex CLI

## Install

**macOS / Linux (curl):**

```bash
curl -fsSL https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install.ps1 | iex
```

**From source:**

```bash
git clone https://github.com/alexsanqp/agent-bridge.git
cd agent-bridge
npm install && npm run build
npm link
```

## Initialize a project

Run `agent-bridge init` from your project root. This will:

1. Create `.agent-bridge/` directory with a SQLite database and config
2. Detect installed AI clients (Cursor, Claude Code, Codex CLI)
3. Generate MCP config entries for each detected client
4. Create `AGENTS.md` with role prompts for peer collaboration

## Verify the setup

```bash
agent-bridge doctor    # Check config, database, and client connectivity
agent-bridge status    # Show active agents, tasks, and inbox
```

## Day-to-day usage

Once initialized, each AI agent session automatically connects to the bridge
via its MCP stdio server. Agents use `peer_send`, `peer_reply`, and other
tools to collaborate through the shared task database.

```bash
agent-bridge tasks             # List all tasks
agent-bridge tasks --status pending  # Filter by status
agent-bridge reset             # Clear all tasks and messages
```
