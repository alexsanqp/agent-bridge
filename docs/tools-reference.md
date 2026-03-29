# MCP Tools Reference

Agent Bridge exposes 9 tools over MCP stdio. Each tool is available to any
connected agent session automatically.

## peer_send

Create a new task addressed to another agent.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | yes | Name of the receiving agent |
| `task_type` | enum | yes | `review`, `debug`, `test`, `question`, `implement` |
| `summary` | string | yes | Short summary of the task |
| `body` | string | yes | Full description of the task |
| `artifacts` | string[] | no | File paths to attach |

**Returns:** `{ task_id, status: "pending" }`

## peer_reply

Reply to a task addressed to this agent.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | yes | ID of the task to reply to |
| `body` | string | yes | Reply content |
| `artifacts` | string[] | no | File paths to attach |

**Returns:** `{ message_id, task_status }`

## peer_inbox

List tasks addressed to this agent. Without a status filter, only non-terminal
tasks are returned.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | enum | no | Filter: `pending`, `active`, `waiting_reply`, `completed`, `failed`, `cancelled`, `expired` |

**Returns:** Array of `{ id, task_type, sender, summary, status, message_count, updated_at }`

## peer_get_task

Get full task details including all messages and artifacts.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | yes | ID of the task to retrieve |

**Returns:** Task object with nested `messages` and `artifacts` arrays

## peer_wait

Poll for a reply or status change on a task. Blocks until a new message
arrives, the status changes, or the timeout is reached.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | yes | ID of the task to watch |
| `timeout_seconds` | number | no | Wait duration in seconds (default 60, max 300) |

**Returns:** `{ status: "reply_received" | "status_changed" | "timeout", new_messages }`

**Note:** Some clients enforce MCP call timeouts that are shorter than the requested wait. Cursor may timeout MCP calls after 30-200 seconds depending on the operation. If `peer_wait` consistently times out, switch to autonomous mode and use `peer_check` for polling instead.

## peer_check

Quick non-blocking check for new activity on a task. Returns immediately with
a count of new messages and the current task status. Use this for lightweight
polling in autonomous mode instead of blocking with `peer_wait`.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | yes | ID of the task to check |
| `since` | string | no | ISO timestamp -- count only messages newer than this |

**Returns:**

```json
{
  "task_id": "a1b2c3",
  "status": "active",
  "new_message_count": 1,
  "last_activity": "2026-03-28T10:30:00Z",
  "sender": "cursor-dev",
  "receiver": "claude-reviewer"
}
```

| Output field | Description |
|-------------|-------------|
| `task_id` | The task ID that was checked |
| `status` | Current task status |
| `new_message_count` | Number of messages (all, or since the `since` timestamp) |
| `last_activity` | ISO timestamp of the most recent message or task update |
| `sender` | Agent that created the task |
| `receiver` | Agent the task is assigned to |

**Errors:** `TASK_NOT_FOUND` if the task ID does not exist.

**Recommended usage:** In autonomous mode, call `peer_check(task_id)` periodically after sending a task. When `new_message_count > 0`, call `peer_get_task(task_id)` to read the full reply.

## peer_complete

Mark a task as completed. Only the sender can complete a task.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | yes | ID of the task to complete |

**Returns:** `{ task_id, status: "completed" }`

## peer_cancel

Cancel a task. Only the sender can cancel.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | yes | ID of the task to cancel |
| `reason` | string | no | Reason for cancellation |

**Returns:** `{ task_id, status: "cancelled" }`

## peer_status

Get bridge status and agent info. Takes no inputs.

**Returns:** `{ agent, active_tasks, pending_inbox, known_agents }`
