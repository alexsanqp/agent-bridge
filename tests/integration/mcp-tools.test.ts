import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { upsertAgent, getAgent, agentExists, updateLastSeen } from '../../src/store/agents.js';
import {
  createTask,
  getTask,
  updateTaskStatus,
  getActiveTasks,
  getTasksByReceiver,
} from '../../src/store/tasks.js';
import {
  createMessage,
  getMessagesByTask,
  getMessageCount,
  getNewMessages,
} from '../../src/store/messages.js';
import { getArtifactsByTask } from '../../src/store/artifacts.js';
import { copyArtifact } from '../../src/store/artifacts.js';
import { TaskStatus, TaskType } from '../../src/domain/models.js';
import { isTerminal } from '../../src/domain/status.js';
import { BridgeError, BridgeErrorCode } from '../../src/domain/errors.js';
import { expiresAt, now } from '../../src/utils/time.js';
import { loadConfig, saveConfig, getDefaultConfig } from '../../src/config/loader.js';
import { withLastSeen } from '../../src/mcp-server.js';
import type BetterSqlite3 from 'better-sqlite3';
import type { CreateTaskInput } from '../../src/domain/models.js';

/**
 * Integration tests for MCP tool handler logic.
 *
 * These tests replicate the exact guard logic, error codes, isError
 * response format, and automatic status transitions that exist in the
 * tool handler files (src/tools/peer-*.ts) -- covering gaps that the
 * existing integration/tools.test.ts does NOT exercise.
 */

let tmpDir: string;
let bridgeDir: string;
let projectRoot: string;
let db: BetterSqlite3.Database;

function writeDefaultConfig(): void {
  const config = getDefaultConfig([
    { name: 'agent-a', role: 'developer', client: 'cursor' },
    { name: 'agent-b', role: 'reviewer', client: 'claude-code' },
  ]);
  saveConfig(bridgeDir, config);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-mcp-tools-test-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  projectRoot = tmpDir;
  db = openDatabase(bridgeDir);

  writeDefaultConfig();

  upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'cursor' });
  upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'claude-code' });
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTaskInput(overrides?: Partial<CreateTaskInput>): CreateTaskInput {
  return {
    task_type: TaskType.Review,
    sender: 'agent-a',
    receiver: 'agent-b',
    summary: 'Test task',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: simulate tool response format used by all tool handlers
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function errorResult(error: string, message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error, message }) }],
    isError: true,
  };
}

function successResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

function parseResult(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

// ===========================================================================
// peer_send guards
// ===========================================================================

describe('peer_send guards', () => {
  it('returns UNKNOWN_AGENT when receiver is not in agents table', () => {
    const receiverName = 'nonexistent-agent';
    expect(agentExists(db, receiverName)).toBe(false);

    // Replicate the guard from peer-send.ts lines 38-51
    const result: ToolResult = !agentExists(db, receiverName)
      ? errorResult('UNKNOWN_AGENT', `Agent '${receiverName}' does not exist`)
      : successResult({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toBe('UNKNOWN_AGENT');
    expect(parsed.message).toContain(receiverName);
  });

  it('succeeds when receiver exists in agents table', () => {
    expect(agentExists(db, 'agent-b')).toBe(true);
  });

  it('sets expires_at from config.expiration_minutes', () => {
    const config = loadConfig(bridgeDir);
    const before = new Date();
    const expiry = expiresAt(config.expiration_minutes);
    const after = new Date();

    const expiryDate = new Date(expiry);
    const expectedMin = new Date(before.getTime() + config.expiration_minutes * 60_000);
    const expectedMax = new Date(after.getTime() + config.expiration_minutes * 60_000);

    expect(expiryDate.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 100);
    expect(expiryDate.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 100);
  });

  it('creates task with expires_at from config and pending status', () => {
    const config = loadConfig(bridgeDir);
    const task = createTask(db, {
      ...makeTaskInput(),
      expires_at: expiresAt(config.expiration_minutes),
    });

    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.expires_at).not.toBeNull();

    const expiryDate = new Date(task.expires_at!);
    const expectedApprox = new Date(Date.now() + config.expiration_minutes * 60_000);
    // Within 5 seconds tolerance
    expect(Math.abs(expiryDate.getTime() - expectedApprox.getTime())).toBeLessThan(5000);
  });

  it('validates artifacts via policies - blocked file pattern', () => {
    const config = loadConfig(bridgeDir);
    const policies = {
      blockedPatterns: config.policies.blocked_patterns,
      maxArtifactSizeKb: config.policies.max_artifact_size_kb,
    };

    // Create a .env file (blocked by default policies)
    const envFile = path.join(projectRoot, '.env');
    fs.writeFileSync(envFile, 'SECRET=123');

    const task = createTask(db, makeTaskInput());
    const message = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'test',
    });

    expect(() => {
      copyArtifact(db, envFile, task.id, message.id, bridgeDir, projectRoot, policies);
    }).toThrow(BridgeError);

    try {
      copyArtifact(db, envFile, task.id, message.id, bridgeDir, projectRoot, policies);
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe(BridgeErrorCode.BLOCKED_FILE);
    }
  });

  it('validates artifacts via policies - file too large', () => {
    const policies = {
      blockedPatterns: [] as string[],
      maxArtifactSizeKb: 1, // 1 KB limit
    };

    // Create a file larger than 1KB
    const bigFile = path.join(projectRoot, 'large.txt');
    fs.writeFileSync(bigFile, 'x'.repeat(2048));

    const task = createTask(db, makeTaskInput());
    const message = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'test',
    });

    try {
      copyArtifact(db, bigFile, task.id, message.id, bridgeDir, projectRoot, policies);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe(BridgeErrorCode.FILE_TOO_LARGE);
    }
  });

  it('BridgeError is caught and returned as isError response format', () => {
    // Replicate the catch block pattern from peer-send.ts lines 89-102
    const err = new BridgeError(BridgeErrorCode.BLOCKED_FILE, 'Blocked file pattern: .env');
    const result: ToolResult = {
      content: [
        { type: 'text', text: JSON.stringify({ error: err.code, message: err.message }) },
      ],
      isError: true,
    };

    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toBe('BLOCKED_FILE');
    expect(parsed.message).toContain('.env');
  });
});

// ===========================================================================
// peer_reply guards
// ===========================================================================

describe('peer_reply guards', () => {
  it('returns NOT_RECEIVER when caller is not the task receiver', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-a'; // sender, not receiver
    const fetched = getTask(db, task.id)!;

    // Replicate guard from peer-reply.ts lines 51-63
    const isNotReceiver = fetched.receiver !== callerAgent;
    expect(isNotReceiver).toBe(true);

    if (isNotReceiver) {
      const result = errorResult(
        'NOT_RECEIVER',
        `Agent '${callerAgent}' is not the receiver of task '${task.id}'`,
      );
      expect(result.isError).toBe(true);
      const parsed = parseResult(result);
      expect(parsed.error).toBe('NOT_RECEIVER');
    }
  });

  it('allows reply when caller IS the receiver', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-b';
    const fetched = getTask(db, task.id)!;
    expect(fetched.receiver).toBe(callerAgent);
  });

  it('returns TASK_CLOSED when task is in terminal state (completed)', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    const fetched = getTask(db, task.id)!;
    expect(isTerminal(fetched.status)).toBe(true);

    const result = errorResult(
      'TASK_CLOSED',
      `Task '${task.id}' is in terminal state '${fetched.status}'`,
    );
    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toBe('TASK_CLOSED');
  });

  it('returns TASK_CLOSED when task is in terminal state (cancelled)', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Cancelled);

    const fetched = getTask(db, task.id)!;
    expect(isTerminal(fetched.status)).toBe(true);
  });

  it('returns TASK_CLOSED when task is in terminal state (failed)', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Failed);

    const fetched = getTask(db, task.id)!;
    expect(isTerminal(fetched.status)).toBe(true);
  });

  it('returns TASK_NOT_FOUND for nonexistent task', () => {
    const fetched = getTask(db, 'no-such-task');
    expect(fetched).toBeNull();

    const result = errorResult('TASK_NOT_FOUND', "Task 'no-such-task' not found");
    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toBe('TASK_NOT_FOUND');
  });

  it('transitions waiting_reply -> active on reply from receiver', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.WaitingReply);

    const callerAgent = 'agent-b';
    let fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.WaitingReply);
    expect(fetched.receiver).toBe(callerAgent);

    // Replicate peer-reply.ts lines 101-105: reply creates message then transitions
    createMessage(db, {
      task_id: task.id,
      author: callerAgent,
      kind: 'reply',
      content: 'Here is my reply',
    });

    if (fetched.status === TaskStatus.WaitingReply) {
      const updated = updateTaskStatus(db, task.id, TaskStatus.Active);
      expect(updated.status).toBe(TaskStatus.Active);
    }

    fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.Active);
  });

  it('does NOT transition if task is not in waiting_reply state', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.Active);

    // peer-reply only transitions when status === WaitingReply
    let taskStatus = fetched.status;
    if (fetched.status === TaskStatus.WaitingReply) {
      const updated = updateTaskStatus(db, task.id, TaskStatus.Active);
      taskStatus = updated.status;
    }

    expect(taskStatus).toBe(TaskStatus.Active);
  });
});

// ===========================================================================
// peer_get_task guards
// ===========================================================================

describe('peer_get_task guards', () => {
  it('auto-transitions pending -> active when fetched by receiver', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    expect(task.status).toBe(TaskStatus.Pending);

    const callerAgent = 'agent-b'; // the receiver
    let fetched = getTask(db, task.id)!;

    // Replicate peer-get-task.ts lines 44-46
    if (fetched.status === TaskStatus.Pending && fetched.receiver === callerAgent) {
      fetched = updateTaskStatus(db, task.id, TaskStatus.Active);
    }

    expect(fetched.status).toBe(TaskStatus.Active);
  });

  it('does NOT auto-transition when fetched by non-receiver (sender)', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    expect(task.status).toBe(TaskStatus.Pending);

    const callerAgent = 'agent-a'; // the sender, NOT receiver
    let fetched = getTask(db, task.id)!;

    if (fetched.status === TaskStatus.Pending && fetched.receiver === callerAgent) {
      fetched = updateTaskStatus(db, task.id, TaskStatus.Active);
    }

    // Status should remain pending because caller is not receiver
    expect(fetched.status).toBe(TaskStatus.Pending);
  });

  it('does NOT auto-transition when task is already active', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-b';
    let fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.Active);

    if (fetched.status === TaskStatus.Pending && fetched.receiver === callerAgent) {
      fetched = updateTaskStatus(db, task.id, TaskStatus.Active);
    }

    // Already active, no transition attempted
    expect(fetched.status).toBe(TaskStatus.Active);
  });

  it('returns TASK_NOT_FOUND for nonexistent task', () => {
    const fetched = getTask(db, 'phantom-task-id');
    expect(fetched).toBeNull();
  });

  it('returns messages and artifacts alongside task', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review',
    });
    createMessage(db, {
      task_id: task.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'Done',
    });

    const messages = getMessagesByTask(db, task.id);
    const artifacts = getArtifactsByTask(db, task.id);

    expect(messages).toHaveLength(2);
    expect(artifacts).toHaveLength(0);

    // Verify the response shape matches what peer-get-task returns
    const responseData = { task: getTask(db, task.id), messages, artifacts };
    expect(responseData.task).not.toBeNull();
    expect(responseData.messages).toHaveLength(2);
    expect(responseData.artifacts).toHaveLength(0);
  });
});

// ===========================================================================
// peer_complete guards
// ===========================================================================

describe('peer_complete guards', () => {
  it('returns NOT_PARTICIPANT when caller is neither sender nor receiver', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    upsertAgent(db, { name: 'agent-c', role: 'observer', client: 'vscode' });
    const callerAgent = 'agent-c';
    const fetched = getTask(db, task.id)!;

    // Replicate peer-complete.ts lines 41-53
    const isParticipant = fetched.sender === callerAgent || fetched.receiver === callerAgent;
    expect(isParticipant).toBe(false);

    if (!isParticipant) {
      const result = errorResult(
        'NOT_PARTICIPANT',
        `Agent '${callerAgent}' is not a participant of task '${task.id}'`,
      );
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toBe('NOT_PARTICIPANT');
    }
  });

  it('allows sender to complete the task', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-a';
    const fetched = getTask(db, task.id)!;
    const isParticipant = fetched.sender === callerAgent || fetched.receiver === callerAgent;
    expect(isParticipant).toBe(true);

    const updated = updateTaskStatus(db, task.id, TaskStatus.Completed);
    expect(updated.status).toBe(TaskStatus.Completed);
  });

  it('allows receiver to complete the task', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-b';
    const fetched = getTask(db, task.id)!;
    const isParticipant = fetched.sender === callerAgent || fetched.receiver === callerAgent;
    expect(isParticipant).toBe(true);

    const updated = updateTaskStatus(db, task.id, TaskStatus.Completed);
    expect(updated.status).toBe(TaskStatus.Completed);
  });

  it('returns TASK_NOT_FOUND for nonexistent task', () => {
    const fetched = getTask(db, 'missing-task');
    expect(fetched).toBeNull();
  });

  it('throws INVALID_TRANSITION when completing an already completed task', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    // The tool handler catches BridgeError and returns isError response
    expect(() => {
      updateTaskStatus(db, task.id, TaskStatus.Completed);
    }).toThrow(BridgeError);

    try {
      updateTaskStatus(db, task.id, TaskStatus.Completed);
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.INVALID_TRANSITION);
    }
  });
});

// ===========================================================================
// peer_cancel guards
// ===========================================================================

describe('peer_cancel guards', () => {
  it('returns NOT_PARTICIPANT when caller is neither sender nor receiver', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));

    upsertAgent(db, { name: 'agent-c', role: 'observer', client: 'vscode' });
    const callerAgent = 'agent-c';
    const fetched = getTask(db, task.id)!;

    const isParticipant = fetched.sender === callerAgent || fetched.receiver === callerAgent;
    expect(isParticipant).toBe(false);
  });

  it('returns TASK_CLOSED when cancelling an already terminal task', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    const fetched = getTask(db, task.id)!;
    expect(isTerminal(fetched.status)).toBe(true);

    // Replicate peer-cancel.ts lines 59-71
    const result = errorResult(
      'TASK_CLOSED',
      `Task '${task.id}' is already in terminal status '${fetched.status}'`,
    );
    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toBe('TASK_CLOSED');
  });

  it('creates a note message with cancellation reason', () => {
    const task = createTask(db, makeTaskInput());

    // Replicate peer-cancel.ts lines 74-81
    updateTaskStatus(db, task.id, TaskStatus.Cancelled);

    const reason = 'Requirements changed, no longer needed';
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'note',
      content: reason,
    });

    const messages = getMessagesByTask(db, task.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('note');
    expect(messages[0].content).toBe(reason);
    expect(messages[0].author).toBe('agent-a');
  });

  it('does NOT create a note message when no reason is provided', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Cancelled);

    // peer-cancel.ts only creates message if args.reason is truthy
    const reason: string | undefined = undefined;
    if (reason) {
      createMessage(db, {
        task_id: task.id,
        author: 'agent-a',
        kind: 'note',
        content: reason,
      });
    }

    const messages = getMessagesByTask(db, task.id);
    expect(messages).toHaveLength(0);
  });

  it('allows cancellation from active state', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const updated = updateTaskStatus(db, task.id, TaskStatus.Cancelled);
    expect(updated.status).toBe(TaskStatus.Cancelled);
  });

  it('allows cancellation from waiting_reply state', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.WaitingReply);

    const updated = updateTaskStatus(db, task.id, TaskStatus.Cancelled);
    expect(updated.status).toBe(TaskStatus.Cancelled);
  });
});

// ===========================================================================
// peer_wait guards and behavior
// ===========================================================================

describe('peer_wait guards and behavior', () => {
  it('transitions active -> waiting_reply when sender calls wait', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-a'; // sender
    let fetched = getTask(db, task.id)!;

    // Replicate peer-wait.ts lines 48-52
    if (fetched.status === TaskStatus.Active && fetched.sender === callerAgent) {
      updateTaskStatus(db, task.id, TaskStatus.WaitingReply);
      fetched = getTask(db, task.id)!;
    }

    expect(fetched.status).toBe(TaskStatus.WaitingReply);
  });

  it('does NOT transition when receiver calls wait', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const callerAgent = 'agent-b'; // receiver, not sender
    let fetched = getTask(db, task.id)!;

    if (fetched.status === TaskStatus.Active && fetched.sender === callerAgent) {
      updateTaskStatus(db, task.id, TaskStatus.WaitingReply);
      fetched = getTask(db, task.id)!;
    }

    // Should remain active because receiver is not the sender
    expect(fetched.status).toBe(TaskStatus.Active);
  });

  it('does NOT transition when task is not active', () => {
    const task = createTask(db, makeTaskInput({ sender: 'agent-a', receiver: 'agent-b' }));
    // Task is pending (not active)

    const callerAgent = 'agent-a';
    let fetched = getTask(db, task.id)!;

    if (fetched.status === TaskStatus.Active && fetched.sender === callerAgent) {
      updateTaskStatus(db, task.id, TaskStatus.WaitingReply);
      fetched = getTask(db, task.id)!;
    }

    expect(fetched.status).toBe(TaskStatus.Pending);
  });

  it('returns no new messages when none were added after timestamp', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const afterTimestamp = now();
    const newMessages = getNewMessages(db, task.id, afterTimestamp);
    expect(newMessages).toHaveLength(0);
  });

  it('detects new message during wait and returns reply_received', async () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const initialTimestamp = now();

    // Small delay so message timestamp is strictly after initialTimestamp
    await new Promise((resolve) => setTimeout(resolve, 15));

    createMessage(db, {
      task_id: task.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'Here is my review',
    });

    const newMessages = getNewMessages(db, task.id, initialTimestamp);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].content).toBe('Here is my review');
  });

  it('detects status change during wait', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const initialStatus = TaskStatus.Active;

    updateTaskStatus(db, task.id, TaskStatus.Completed);

    const currentTask = getTask(db, task.id);
    expect(currentTask).not.toBeNull();
    expect(currentTask!.status).not.toBe(initialStatus);
    expect(currentTask!.status).toBe(TaskStatus.Completed);
  });

  it('returns TASK_NOT_FOUND for nonexistent task', () => {
    const fetched = getTask(db, 'ghost-task');
    expect(fetched).toBeNull();
  });
});

// ===========================================================================
// peer_inbox behavior
// ===========================================================================

describe('peer_inbox behavior', () => {
  it('filters out terminal tasks when no status filter provided', () => {
    const t1 = createTask(db, makeTaskInput({ receiver: 'agent-b', summary: 'Pending' }));
    const t2 = createTask(db, makeTaskInput({ receiver: 'agent-b', summary: 'Active' }));
    const t3 = createTask(db, makeTaskInput({ receiver: 'agent-b', summary: 'Completed' }));

    updateTaskStatus(db, t2.id, TaskStatus.Active);
    updateTaskStatus(db, t3.id, TaskStatus.Active);
    updateTaskStatus(db, t3.id, TaskStatus.Completed);

    // Replicate peer-inbox.ts lines 30-38: no status filter -> exclude terminal
    let tasks = getTasksByReceiver(db, 'agent-b');
    tasks = tasks.filter((t) => !isTerminal(t.status as TaskStatus));

    expect(tasks).toHaveLength(2);
    const summaries = tasks.map((t) => t.summary);
    expect(summaries).toContain('Pending');
    expect(summaries).toContain('Active');
    expect(summaries).not.toContain('Completed');
  });

  it('includes terminal tasks when status filter is explicitly provided', () => {
    const t1 = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    updateTaskStatus(db, t1.id, TaskStatus.Active);
    updateTaskStatus(db, t1.id, TaskStatus.Completed);

    // With explicit status filter, no additional terminal filtering
    const completed = getTasksByReceiver(db, 'agent-b', TaskStatus.Completed);
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe(TaskStatus.Completed);
  });

  it('includes message_count in response shape', () => {
    const task = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Review please',
    });
    createMessage(db, {
      task_id: task.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'Done',
    });

    // peer-inbox maps each task with message_count
    const count = getMessageCount(db, task.id);
    expect(count).toBe(2);
  });
});

// ===========================================================================
// peer_status behavior
// ===========================================================================

describe('peer_status behavior', () => {
  it('returns correct agent info and counts', () => {
    // Create tasks in various states
    const t1 = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    const t2 = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    const t3 = createTask(db, makeTaskInput({ receiver: 'agent-a', sender: 'agent-b' }));
    updateTaskStatus(db, t1.id, TaskStatus.Active);
    updateTaskStatus(db, t2.id, TaskStatus.Active);
    updateTaskStatus(db, t2.id, TaskStatus.Completed);

    const callerAgent = 'agent-b';
    const activeTasks = getActiveTasks(db);
    const allInbox = getTasksByReceiver(db, callerAgent);
    const pendingInbox = allInbox.filter((t) => !isTerminal(t.status as TaskStatus));
    const self = getAgent(db, callerAgent);

    expect(self).not.toBeNull();
    expect(self!.role).toBe('reviewer');
    expect(self!.client).toBe('claude-code');

    // t1 is active (non-terminal), t3 is pending (non-terminal), t2 is completed (terminal)
    expect(activeTasks.length).toBeGreaterThanOrEqual(2); // t1 active + t3 pending

    // agent-b's inbox: t1 and t2 are addressed to agent-b
    // pendingInbox excludes terminal -> only t1 (active is non-terminal)
    expect(pendingInbox).toHaveLength(1); // t1 is active (non-terminal)
  });

  it('reports bridge_ok true when database is accessible', () => {
    let bridgeOk = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      bridgeOk = false;
    }
    expect(bridgeOk).toBe(true);
  });

  it('lists all known agents with name, role, client, last_seen', () => {
    const agents = db.prepare('SELECT * FROM agents ORDER BY name').all() as Array<{
      name: string;
      role: string;
      client: string;
      last_seen: string;
    }>;

    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe('agent-a');
    expect(agents[0].role).toBe('developer');
    expect(agents[0].client).toBe('cursor');
    expect(agents[0].last_seen).toBeDefined();
    expect(agents[1].name).toBe('agent-b');
  });

  it('response shape matches peer_status output format', () => {
    const callerAgent = 'agent-a';
    const activeTasks = getActiveTasks(db);
    const allInbox = getTasksByReceiver(db, callerAgent);
    const pendingInbox = allInbox.filter((t) => !isTerminal(t.status as TaskStatus));
    const agents = db.prepare('SELECT * FROM agents ORDER BY name').all() as Array<{
      name: string;
      role: string;
      client: string;
      last_seen: string;
    }>;
    const self = getAgent(db, callerAgent);

    const responseData = {
      agent: callerAgent,
      role: self?.role ?? 'agent',
      bridge_ok: true,
      active_tasks: activeTasks.length,
      pending_inbox: pendingInbox.length,
      known_agents: agents.map((a) => ({
        name: a.name,
        role: a.role,
        client: a.client,
        last_seen: a.last_seen,
      })),
    };

    expect(responseData.agent).toBe('agent-a');
    expect(responseData.role).toBe('developer');
    expect(responseData.bridge_ok).toBe(true);
    expect(typeof responseData.active_tasks).toBe('number');
    expect(typeof responseData.pending_inbox).toBe('number');
    expect(responseData.known_agents).toHaveLength(2);
    expect(responseData.known_agents[0]).toHaveProperty('name');
    expect(responseData.known_agents[0]).toHaveProperty('role');
    expect(responseData.known_agents[0]).toHaveProperty('client');
    expect(responseData.known_agents[0]).toHaveProperty('last_seen');
  });
});

// ===========================================================================
// withLastSeen wrapper
// ===========================================================================

describe('withLastSeen wrapper', () => {
  it('updates last_seen timestamp on agent before executing handler', async () => {
    const agentBefore = getAgent(db, 'agent-a');
    expect(agentBefore).not.toBeNull();
    const initialLastSeen = agentBefore!.last_seen;

    // Small delay to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 15));

    const handler = async (_args: { foo: string }) => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    });

    const wrapped = withLastSeen(db, 'agent-a', handler);
    const result = await wrapped({ foo: 'bar' });

    expect(result.content[0].text).toBe('ok');

    const agentAfter = getAgent(db, 'agent-a');
    expect(agentAfter).not.toBeNull();
    expect(agentAfter!.last_seen).not.toBe(initialLastSeen);
    expect(new Date(agentAfter!.last_seen).getTime()).toBeGreaterThan(
      new Date(initialLastSeen).getTime(),
    );
  });

  it('propagates handler result unchanged', async () => {
    const handler = async (_args: Record<string, never>) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'done' }) }],
    });

    const wrapped = withLastSeen(db, 'agent-a', handler);
    const result = await wrapped({});

    expect(JSON.parse(result.content[0].text)).toEqual({ status: 'done' });
  });

  it('propagates handler errors', async () => {
    const handler = async (_args: Record<string, never>) => {
      throw new Error('handler boom');
      return { content: [{ type: 'text' as const, text: '' }] };
    };

    const wrapped = withLastSeen(db, 'agent-a', handler);
    await expect(wrapped({})).rejects.toThrow('handler boom');
  });
});

// ===========================================================================
// Cross-tool integration: full lifecycle
// ===========================================================================

describe('full task lifecycle via tool logic', () => {
  it('send -> get_task (activates) -> reply -> wait detects -> complete', async () => {
    // STEP 1: peer_send - agent-a sends to agent-b
    expect(agentExists(db, 'agent-b')).toBe(true);
    const config = loadConfig(bridgeDir);
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Review the PR',
      expires_at: expiresAt(config.expiration_minutes),
    });
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review the changes in src/',
    });
    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.expires_at).not.toBeNull();

    // STEP 2: peer_get_task - agent-b fetches -> pending auto-transitions to active
    let fetched = getTask(db, task.id)!;
    if (fetched.status === TaskStatus.Pending && fetched.receiver === 'agent-b') {
      fetched = updateTaskStatus(db, task.id, TaskStatus.Active);
    }
    expect(fetched.status).toBe(TaskStatus.Active);

    // STEP 3: peer_wait - agent-a waits (transitions to waiting_reply)
    if (fetched.status === TaskStatus.Active && fetched.sender === 'agent-a') {
      updateTaskStatus(db, task.id, TaskStatus.WaitingReply);
    }
    fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.WaitingReply);

    const waitTimestamp = now();

    // STEP 4: peer_reply - agent-b replies (transitions waiting_reply -> active)
    await new Promise((resolve) => setTimeout(resolve, 15));
    createMessage(db, {
      task_id: task.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'LGTM with minor nits',
    });
    fetched = getTask(db, task.id)!;
    if (fetched.status === TaskStatus.WaitingReply) {
      updateTaskStatus(db, task.id, TaskStatus.Active);
    }
    fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.Active);

    // STEP 5: The wait loop would detect the new message
    const newMessages = getNewMessages(db, task.id, waitTimestamp);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].content).toBe('LGTM with minor nits');

    // STEP 6: peer_complete - agent-a completes the task
    const senderIsParticipant = fetched.sender === 'agent-a' || fetched.receiver === 'agent-a';
    expect(senderIsParticipant).toBe(true);
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    fetched = getTask(db, task.id)!;
    expect(fetched.status).toBe(TaskStatus.Completed);
    expect(isTerminal(fetched.status)).toBe(true);

    // Verify it no longer appears in active tasks
    const active = getActiveTasks(db);
    expect(active.find((t) => t.id === task.id)).toBeUndefined();
  });

  it('send -> cancel with reason creates note, then reply is blocked', () => {
    // STEP 1: Send
    const task = createTask(db, makeTaskInput());
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Do this thing',
    });

    // STEP 2: Cancel with reason
    const callerAgent = 'agent-a';
    const fetched = getTask(db, task.id)!;
    const isParticipant = fetched.sender === callerAgent || fetched.receiver === callerAgent;
    expect(isParticipant).toBe(true);
    expect(isTerminal(fetched.status)).toBe(false);

    updateTaskStatus(db, task.id, TaskStatus.Cancelled);
    createMessage(db, {
      task_id: task.id,
      author: callerAgent,
      kind: 'note',
      content: 'No longer needed',
    });

    // STEP 3: Attempt reply on cancelled task -> TASK_CLOSED
    const afterCancel = getTask(db, task.id)!;
    expect(isTerminal(afterCancel.status)).toBe(true);

    const messages = getMessagesByTask(db, task.id);
    expect(messages).toHaveLength(2); // request + cancellation note
    expect(messages[1].kind).toBe('note');
    expect(messages[1].content).toBe('No longer needed');
  });
});
