# Troubleshooting

## MCP server not connecting

**Symptom:** Agent client shows "tool not found" or MCP connection errors.

1. Run `agent-bridge doctor` to verify the setup.
2. Check that the MCP config was generated for your client:
   - **Cursor:** `.cursor/mcp.json` in the project root
   - **Claude Code:** `.mcp.json` in the project root
   - **Codex CLI:** `.codex/config.toml` in the project root
3. Ensure the `agent-bridge` binary is on your `PATH`. Run `which agent-bridge`
   (or `where agent-bridge` on Windows) to confirm.
4. Restart the AI client after running `agent-bridge init`.

## peer_wait times out

**Symptom:** `peer_wait` returns `timeout` before the other agent has had time to respond.

Some clients enforce MCP call duration limits. Cursor may timeout MCP tool calls after 30-200 seconds, which is often shorter than the time needed for another agent to process a task and reply.

**Solution:** Switch to autonomous mode and use `peer_check` for polling:

1. Set `autonomy.mode: autonomous` in `.agent-bridge/config.yaml`
2. Run `agent-bridge init` to regenerate instruction files
3. Agents will now use `peer_check` (non-blocking) instead of `peer_wait` (blocking)

## Agent does not check inbox automatically

**Symptom:** An agent starts a session but does not process pending tasks from other agents unless you manually tell it to check.

This happens in manual mode, where agents only use collaboration tools when the user explicitly requests it.

**Solution:** Switch to autonomous mode:

1. Set `autonomy.mode: autonomous` in `.agent-bridge/config.yaml`
2. Run `agent-bridge init` to regenerate instruction files
3. Restart the AI client session

In autonomous mode, the generated instructions tell agents to call `peer_inbox` at session start and process any pending tasks before doing other work.

## Role is wrong after init

**Symptom:** An agent has the wrong role (e.g., shows as "developer" but should be "reviewer").

Roles are stored in `.agent-bridge/config.yaml` under the `agents` section. The init command uses whatever was entered during the interactive prompt.

**Solution:**

1. Edit `.agent-bridge/config.yaml` and change the `role` field for the agent
2. Run `agent-bridge init --force` to regenerate all instruction and role files
3. Restart the AI client session to pick up the new instructions

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
(default: 30 minutes). Increase this value for long-running review tasks.

## Agent was disabled but I want to enable it

**Symptom:** An agent exists in `config.yaml` with `enabled: false` and is not participating in collaboration.

**Solution:**

1. Edit `.agent-bridge/config.yaml` and set `enabled: true` for the agent
2. Run `agent-bridge init` to regenerate instruction files with the agent included
3. Restart the AI client session

## Database locked errors

SQLite WAL mode supports concurrent readers but only one writer at a time.
If you see "database is locked," it usually means a zombie `agent-bridge`
process is holding a write lock. Kill stale processes and retry:

```bash
agent-bridge reset   # clears tasks and releases locks
```
