import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask, getTask, getTasksByReceiver, updateTaskStatus, getActiveTasks, cleanupTasks } from '../../src/store/tasks.js';
import { createMessage, getMessagesByTask, getNewMessages, getMessageCount } from '../../src/store/messages.js';
import { upsertAgent, getAgents, getAgent } from '../../src/store/agents.js';
import { TaskStatus, TaskType } from '../../src/domain/models.js';
import type { CreateTaskInput } from '../../src/domain/models.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-tools-test-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);

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
    summary: 'Review the implementation',
    ...overrides,
  };
}

describe('peer_send flow', () => {
  it('creates a task from agent-a to agent-b with pending status', () => {
    const task = createTask(db, makeTaskInput());

    expect(task.id).toBeDefined();
    expect(task.sender).toBe('agent-a');
    expect(task.receiver).toBe('agent-b');
    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.task_type).toBe(TaskType.Review);
    expect(task.summary).toBe('Review the implementation');

    const fetched = getTask(db, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe(TaskStatus.Pending);
  });

  it('creates initial request message alongside the task', () => {
    const task = createTask(db, makeTaskInput());
    const message = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review the PR changes',
    });

    expect(message.kind).toBe('request');
    expect(message.author).toBe('agent-a');
    expect(message.task_id).toBe(task.id);

    const messages = getMessagesByTask(db, task.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('request');
  });
});

describe('peer_inbox flow', () => {
  it('returns tasks addressed to the queried receiver', () => {
    createTask(db, makeTaskInput({ receiver: 'agent-b', summary: 'Task 1' }));
    createTask(db, makeTaskInput({ receiver: 'agent-b', summary: 'Task 2' }));
    createTask(db, makeTaskInput({ receiver: 'agent-a', summary: 'Task 3' }));

    const inboxB = getTasksByReceiver(db, 'agent-b');
    const inboxA = getTasksByReceiver(db, 'agent-a');

    expect(inboxB).toHaveLength(2);
    expect(inboxA).toHaveLength(1);
  });

  it('filters inbox by status', () => {
    const t1 = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    updateTaskStatus(db, t1.id, TaskStatus.Active);

    const pending = getTasksByReceiver(db, 'agent-b', TaskStatus.Pending);
    const active = getTasksByReceiver(db, 'agent-b', TaskStatus.Active);

    expect(pending).toHaveLength(1);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(t1.id);
  });
});

describe('peer_get_task flow', () => {
  it('transitions pending task to active when retrieved by receiver', () => {
    const task = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    expect(task.status).toBe(TaskStatus.Pending);

    // Simulate what peer_get_task does: if pending and receiver matches, transition to active
    const fetched = getTask(db, task.id);
    expect(fetched).not.toBeNull();

    if (fetched!.status === TaskStatus.Pending && fetched!.receiver === 'agent-b') {
      const updated = updateTaskStatus(db, task.id, TaskStatus.Active);
      expect(updated.status).toBe(TaskStatus.Active);
    }

    const refetched = getTask(db, task.id);
    expect(refetched!.status).toBe(TaskStatus.Active);
  });

  it('returns null for non-existent task', () => {
    const result = getTask(db, 'nonexistent-task-id');
    expect(result).toBeNull();
  });
});

describe('peer_reply flow', () => {
  it('creates a reply message on an active task', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    // Initial request message
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review this code',
    });

    // Reply from agent-b
    const reply = createMessage(db, {
      task_id: task.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'Looks good, minor nits',
    });

    expect(reply.kind).toBe('reply');
    expect(reply.author).toBe('agent-b');
  });

  it('results in message count of 2 after request + reply', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

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
      content: 'Done reviewing',
    });

    expect(getMessageCount(db, task.id)).toBe(2);

    const messages = getMessagesByTask(db, task.id);
    expect(messages[0].kind).toBe('request');
    expect(messages[1].kind).toBe('reply');
  });
});

describe('peer_wait simulation', () => {
  it('getNewMessages returns messages created after a given timestamp', async () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    // Initial request
    const request = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review',
    });

    const cutoff = request.created_at;

    // Small delay so the reply has a later timestamp
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Reply arrives after the cutoff
    createMessage(db, {
      task_id: task.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'Here is my review',
    });

    const newMessages = getNewMessages(db, task.id, cutoff);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].content).toBe('Here is my review');
    expect(newMessages[0].kind).toBe('reply');
  });

  it('getNewMessages returns empty when no new messages exist', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const timestamp = new Date().toISOString();

    const newMessages = getNewMessages(db, task.id, timestamp);
    expect(newMessages).toHaveLength(0);
  });
});

describe('peer_complete flow', () => {
  it('transitions task through pending -> active -> completed', () => {
    const task = createTask(db, makeTaskInput());
    expect(task.status).toBe(TaskStatus.Pending);

    const active = updateTaskStatus(db, task.id, TaskStatus.Active);
    expect(active.status).toBe(TaskStatus.Active);

    const completed = updateTaskStatus(db, task.id, TaskStatus.Completed);
    expect(completed.status).toBe(TaskStatus.Completed);

    const fetched = getTask(db, task.id);
    expect(fetched!.status).toBe(TaskStatus.Completed);
  });

  it('completed task does not appear in active tasks', () => {
    const t1 = createTask(db, makeTaskInput());
    const t2 = createTask(db, makeTaskInput());

    updateTaskStatus(db, t1.id, TaskStatus.Active);
    updateTaskStatus(db, t1.id, TaskStatus.Completed);

    const activeTasks = getActiveTasks(db);
    expect(activeTasks).toHaveLength(1);
    expect(activeTasks[0].id).toBe(t2.id);
  });
});

describe('peer_cancel flow', () => {
  it('cancels a pending task', () => {
    const task = createTask(db, makeTaskInput());

    const cancelled = updateTaskStatus(db, task.id, TaskStatus.Cancelled);
    expect(cancelled.status).toBe(TaskStatus.Cancelled);

    const fetched = getTask(db, task.id);
    expect(fetched!.status).toBe(TaskStatus.Cancelled);
  });

  it('stores cancellation reason as a note message', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Cancelled);

    // Simulate the cancel reason note that the tool creates
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'note',
      content: 'Cancelled: requirements changed',
    });

    const messages = getMessagesByTask(db, task.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('note');
    expect(messages[0].content).toContain('Cancelled');
  });

  it('cancels an active task', () => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);

    const cancelled = updateTaskStatus(db, task.id, TaskStatus.Cancelled);
    expect(cancelled.status).toBe(TaskStatus.Cancelled);
  });
});

describe('peer_status simulation', () => {
  it('reports active task count correctly', () => {
    const t1 = createTask(db, makeTaskInput());
    const t2 = createTask(db, makeTaskInput());
    createTask(db, makeTaskInput());

    updateTaskStatus(db, t1.id, TaskStatus.Active);
    updateTaskStatus(db, t1.id, TaskStatus.Completed);
    updateTaskStatus(db, t2.id, TaskStatus.Cancelled);

    // 1 pending task remains active (non-terminal)
    const activeTasks = getActiveTasks(db);
    expect(activeTasks).toHaveLength(1);
  });

  it('reports pending tasks for a specific receiver', () => {
    createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    const t3 = createTask(db, makeTaskInput({ receiver: 'agent-b' }));
    updateTaskStatus(db, t3.id, TaskStatus.Active);

    const pendingForB = getTasksByReceiver(db, 'agent-b', TaskStatus.Pending);
    expect(pendingForB).toHaveLength(2);
  });

  it('lists all known agents', () => {
    const agents = getAgents(db);
    expect(agents).toHaveLength(2);

    const names = agents.map((a) => a.name);
    expect(names).toContain('agent-a');
    expect(names).toContain('agent-b');

    const agentA = getAgent(db, 'agent-a');
    expect(agentA).not.toBeNull();
    expect(agentA!.role).toBe('developer');
    expect(agentA!.client).toBe('cursor');

    const agentB = getAgent(db, 'agent-b');
    expect(agentB).not.toBeNull();
    expect(agentB!.role).toBe('reviewer');
    expect(agentB!.client).toBe('claude-code');
  });
});
