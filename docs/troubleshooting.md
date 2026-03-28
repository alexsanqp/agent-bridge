# Troubleshooting

## MCP server not connecting

**Symptom:** Agent client shows "tool not found" or MCP connection errors.

1. Run `agent-bridge doctor` to verify the setup.
2. Check that the MCP config was generated for your client:
   - **Cursor:** `.cursor/mcp.json` in the project root
   - **Claude Code:** `.claude/claude_desktop_config.json` or project-level config
   - **Codex CLI:** `.codex/config.json`
3. Ensure the `agent-bridge` binary is on your `PATH`. Run `which agent-bridge`
   (or `where agent-bridge` on Windows) to confirm.
4. Restart the AI client after running `agent-bridge init`.

## Stale database path after moving a project

**Symptom:** Commands work but agents cannot find each other, or tasks are missing.

The SQLite database lives at `.agent-bridge/bridge.db` relative to the project
root. If you moved or renamed the project directory:

1. Run `agent-bridge init` again to regenerate configs with the new path.
2. Old task data is preserved in the database file itself; only MCP paths need
   updating.

## WSL / Windows boundary issues

**Symptom:** Agents running inside WSL cannot communicate with agents running
on the Windows host (or vice versa).

The SQLite database uses file-system locking. WSL and Windows see different
filesystem namespaces, so they cannot share the same `.agent-bridge/` directory
reliably.

**Workaround:** Run all collaborating agents on the same side of the boundary
(all in WSL, or all in Windows). If you must cross the boundary, initialize
the project from the Windows path (`/mnt/c/...` inside WSL) so both sides
resolve to the same file.

## Artifact copy fails

**Symptom:** `BLOCKED_PATTERN` or `ARTIFACT_TOO_LARGE` error when sending.

- Check `.agent-bridge/config.yaml` for `blocked_patterns` (default blocks
  `.env`, credentials, and binary files).
- Increase `max_artifact_size_kb` if the file is legitimately large.
- Artifacts must be within the project root; paths outside the boundary are
  rejected.

## Tasks expire unexpectedly

Tasks have a configurable TTL set by `expiration_minutes` in the config
(default: 60 minutes). Increase this value for long-running review tasks.

## Database locked errors

SQLite WAL mode supports concurrent readers but only one writer at a time.
If you see "database is locked," it usually means a zombie `agent-bridge`
process is holding a write lock. Kill stale processes and retry:

```bash
agent-bridge reset   # clears tasks and releases locks
```
