# MCP Tools Reference

Agent Bridge exposes 8 tools over MCP stdio. Each tool is available to any
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
