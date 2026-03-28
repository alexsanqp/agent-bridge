import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { upsertAgent } from '../../src/store/agents.js';
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
import { copyArtifact, getArtifactsByTask } from '../../src/store/artifacts.js';
import { TaskStatus, TaskType } from '../../src/domain/models.js';
import { isTerminal } from '../../src/domain/status.js';
import { BridgeError, BridgeErrorCode } from '../../src/domain/errors.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let projectRoot: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-edge-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  projectRoot = tmpDir;
  db = openDatabase(bridgeDir);

  upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'claude' });
  upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'cursor' });
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Rapid-fire messaging
// ---------------------------------------------------------------------------

describe('rapid-fire messaging', () => {
  it('10 tasks sent in rapid succession are all created with unique IDs', () => {
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(
        createTask(db, {
          task_type: TaskType.Implement,
          sender: 'agent-a',
          receiver: 'agent-b',
          summary: `Task #${i}`,
        }),
      );
      createMessage(db, {
        task_id: tasks[i].id,
        author: 'agent-a',
        kind: 'request',
        content: `Request for task #${i}`,
      });
    }

    // All IDs are unique
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(10);

    // All are pending
    tasks.forEach((t) => expect(t.status).toBe(TaskStatus.Pending));

    // Agent B sees all 10
    const inbox = getTasksByReceiver(db, 'agent-b', TaskStatus.Pending);
    expect(inbox).toHaveLength(10);

    // Agent B replies in reverse order
    for (let i = 9; i >= 0; i--) {
      updateTaskStatus(db, tasks[i].id, TaskStatus.Active);
      createMessage(db, {
        task_id: tasks[i].id,
        author: 'agent-b',
        kind: 'reply',
        content: `Reply to task #${i}`,
      });
    }

    // Each task has exactly 2 messages
    for (const task of tasks) {
      expect(getMessageCount(db, task.id)).toBe(2);
    }

    // Messages within each task are in ascending created_at order
    for (const task of tasks) {
      const msgs = getMessagesByTask(db, task.id);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].created_at <= msgs[1].created_at).toBe(true);
      expect(msgs[0].kind).toBe('request');
      expect(msgs[1].kind).toBe('reply');
    }
  });
});

// ---------------------------------------------------------------------------
// Self-send
// ---------------------------------------------------------------------------

describe('self-send', () => {
  it('agent can send a task to itself and complete the full lifecycle', () => {
    const task = createTask(db, {
      task_type: TaskType.Debug,
      sender: 'agent-a',
      receiver: 'agent-a',
      summary: 'Self-assigned debug task',
    });

    expect(task.sender).toBe('agent-a');
    expect(task.receiver).toBe('agent-a');
    expect(task.status).toBe(TaskStatus.Pending);

    // Appears in own inbox
    const inbox = getTasksByReceiver(db, 'agent-a', TaskStatus.Pending);
    expect(inbox.some((t) => t.id === task.id)).toBe(true);

    // Transition to active
    updateTaskStatus(db, task.id, TaskStatus.Active);

    // Reply to own task
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Investigating the issue',
    });

    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'reply',
      content: 'Found and fixed the bug',
    });

    // Complete own task
    const completed = updateTaskStatus(db, task.id, TaskStatus.Completed);
    expect(completed.status).toBe(TaskStatus.Completed);

    const final = getTask(db, task.id);
    expect(final!.status).toBe(TaskStatus.Completed);
    expect(getMessageCount(db, task.id)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Multiple replies
// ---------------------------------------------------------------------------

describe('multiple replies', () => {
  it('multiple follow-up replies are tracked correctly', async () => {
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Multi-reply review',
    });

    const requestMsg = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review src/auth.ts',
    });

    updateTaskStatus(db, task.id, TaskStatus.Active);

    // Agent B sends 3 replies with small delays for distinct timestamps
    const replies = [];
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      replies.push(
        createMessage(db, {
          task_id: task.id,
          author: 'agent-b',
          kind: 'reply',
          content: `Follow-up #${i + 1}`,
        }),
      );
    }

    // Total: 1 request + 3 replies = 4
    expect(getMessageCount(db, task.id)).toBe(4);

    const allMsgs = getMessagesByTask(db, task.id);
    expect(allMsgs).toHaveLength(4);
    expect(allMsgs[0].kind).toBe('request');
    expect(allMsgs[0].author).toBe('agent-a');
    expect(allMsgs[1].kind).toBe('reply');
    expect(allMsgs[2].kind).toBe('reply');
    expect(allMsgs[3].kind).toBe('reply');
    allMsgs.slice(1).forEach((m) => expect(m.author).toBe('agent-b'));

    // getNewMessages with various timestamps
    const afterRequest = getNewMessages(db, task.id, requestMsg.created_at);
    expect(afterRequest).toHaveLength(3);

    const afterFirstReply = getNewMessages(db, task.id, replies[0].created_at);
    expect(afterFirstReply).toHaveLength(2);

    const afterSecondReply = getNewMessages(db, task.id, replies[1].created_at);
    expect(afterSecondReply).toHaveLength(1);
    expect(afterSecondReply[0].id).toBe(replies[2].id);

    const afterLastReply = getNewMessages(db, task.id, replies[2].created_at);
    expect(afterLastReply).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Status boundary conditions
// ---------------------------------------------------------------------------

describe('status boundary conditions', () => {
  it('expired task cannot receive a reply (guard replicates tool handler)', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'About to expire',
      expires_at: pastDate,
    });

    // Reading the task triggers lazy expiration
    const fetched = getTask(db, task.id);
    expect(fetched!.status).toBe(TaskStatus.Expired);

    // Replicate the TASK_CLOSED guard from peer-reply.ts
    expect(isTerminal(fetched!.status)).toBe(true);
  });

  it('cancelled task cannot be completed (INVALID_TRANSITION)', () => {
    const task = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Will be cancelled',
    });

    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Cancelled);

    expect(() => updateTaskStatus(db, task.id, TaskStatus.Completed)).toThrow(BridgeError);
    try {
      updateTaskStatus(db, task.id, TaskStatus.Completed);
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.INVALID_TRANSITION);
    }
  });

  it('completed task cannot be cancelled (INVALID_TRANSITION)', () => {
    const task = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Will be completed',
    });

    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    expect(() => updateTaskStatus(db, task.id, TaskStatus.Cancelled)).toThrow(BridgeError);
    try {
      updateTaskStatus(db, task.id, TaskStatus.Cancelled);
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.INVALID_TRANSITION);
    }
  });

  it('completed task is terminal (guard replicates tool handler TASK_CLOSED)', () => {
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'To be completed',
    });

    updateTaskStatus(db, task.id, TaskStatus.Active);
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    const fetched = getTask(db, task.id);
    expect(isTerminal(fetched!.status)).toBe(true);

    // All terminal statuses are truly terminal
    for (const status of [TaskStatus.Completed, TaskStatus.Failed, TaskStatus.Cancelled, TaskStatus.Expired]) {
      expect(isTerminal(status)).toBe(true);
    }

    // All non-terminal statuses are not terminal
    for (const status of [TaskStatus.Pending, TaskStatus.Active, TaskStatus.WaitingReply]) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Artifact edge cases
// ---------------------------------------------------------------------------

describe('artifact edge cases', () => {
  function createTaskWithMessage(): { taskId: string; messageId: string } {
    const task = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Artifact test',
    });
    const msg = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: 'See attached',
    });
    return { taskId: task.id, messageId: msg.id };
  }

  it('artifact at exactly 1MB succeeds', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const filePath = path.join(projectRoot, 'exact-1mb.bin');
    fs.writeFileSync(filePath, Buffer.alloc(1024 * 1024, 0x42));

    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };
    const artifact = copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);
    expect(artifact.size).toBe(1024 * 1024);
  });

  it('artifact at 1MB + 1 byte fails with FILE_TOO_LARGE', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const filePath = path.join(projectRoot, 'over-1mb.bin');
    fs.writeFileSync(filePath, Buffer.alloc(1024 * 1024 + 1, 0x42));

    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };
    expect(() =>
      copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies),
    ).toThrow(BridgeError);

    try {
      copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.FILE_TOO_LARGE);
    }
  });

  it('artifact with Unicode filename works', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const filePath = path.join(projectRoot, 'файл-тест.txt');
    fs.writeFileSync(filePath, 'unicode content');

    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };
    const artifact = copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);
    expect(artifact.filename).toBe('файл-тест.txt');
  });

  it('artifact with spaces in path works', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const dir = path.join(projectRoot, 'my folder');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'my file.txt');
    fs.writeFileSync(filePath, 'spaced content');

    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };
    const artifact = copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);
    expect(artifact.filename).toBe('my file.txt');
  });

  it('artifact SHA-256 checksum matches independent computation', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const content = 'checksum verification content - test 12345';
    const filePath = path.join(projectRoot, 'checksum-test.txt');
    fs.writeFileSync(filePath, content);

    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };
    const artifact = copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);

    const expected = createHash('sha256').update(Buffer.from(content)).digest('hex');
    expect(artifact.checksum).toBe(expected);
  });

  it('multiple artifacts on same task are all stored correctly', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };

    for (let i = 0; i < 3; i++) {
      const filePath = path.join(projectRoot, `file-${i}.txt`);
      fs.writeFileSync(filePath, `content-${i}`);
      copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);
    }

    const artifacts = getArtifactsByTask(db, taskId);
    expect(artifacts).toHaveLength(3);
    const filenames = artifacts.map((a) => a.filename);
    expect(filenames).toContain('file-0.txt');
    expect(filenames).toContain('file-1.txt');
    expect(filenames).toContain('file-2.txt');
  });

  it('artifact path is stored as relative (not absolute)', () => {
    const { taskId, messageId } = createTaskWithMessage();
    const filePath = path.join(projectRoot, 'relative-check.txt');
    fs.writeFileSync(filePath, 'content');

    const policies = { blockedPatterns: [] as string[], maxArtifactSizeKb: 1024 };
    const artifact = copyArtifact(db, filePath, taskId, messageId, bridgeDir, projectRoot, policies);

    expect(path.isAbsolute(artifact.path)).toBe(false);
    expect(artifact.path).not.toContain('\\');
    expect(artifact.path.startsWith('artifacts/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrent task lifecycle
// ---------------------------------------------------------------------------

describe('concurrent task lifecycle', () => {
  it('3 DB connections to same file see consistent state', () => {
    // Open 2 additional connections (db is connection 1)
    const db2 = openDatabase(bridgeDir);
    const db3 = openDatabase(bridgeDir);

    try {
      // Connection 1: create task
      upsertAgent(db2, { name: 'agent-a', role: 'developer', client: 'claude' });
      upsertAgent(db3, { name: 'agent-a', role: 'developer', client: 'claude' });

      const task = createTask(db, {
        task_type: TaskType.Review,
        sender: 'agent-a',
        receiver: 'agent-b',
        summary: 'Concurrent test',
      });

      createMessage(db, {
        task_id: task.id,
        author: 'agent-a',
        kind: 'request',
        content: 'Concurrent request',
      });

      // Connection 2: reads task -> active
      const readByDb2 = getTask(db2, task.id);
      expect(readByDb2).not.toBeNull();
      expect(readByDb2!.status).toBe(TaskStatus.Pending);
      updateTaskStatus(db2, task.id, TaskStatus.Active);

      // Connection 3: reads task -> still active (not re-transitioned)
      const readByDb3 = getTask(db3, task.id);
      expect(readByDb3!.status).toBe(TaskStatus.Active);

      // Connection 2: replies
      createMessage(db2, {
        task_id: task.id,
        author: 'agent-b',
        kind: 'reply',
        content: 'Reply from connection 2',
      });

      // Connection 1 sees the reply
      const msgsDb1 = getMessagesByTask(db, task.id);
      expect(msgsDb1).toHaveLength(2);
      expect(msgsDb1[1].content).toBe('Reply from connection 2');

      // Connection 3 also sees the reply
      const msgsDb3 = getMessagesByTask(db3, task.id);
      expect(msgsDb3).toHaveLength(2);

      // Connection 1: completes task
      updateTaskStatus(db, task.id, TaskStatus.Completed);

      // All 3 connections see completed
      expect(getTask(db, task.id)!.status).toBe(TaskStatus.Completed);
      expect(getTask(db2, task.id)!.status).toBe(TaskStatus.Completed);
      expect(getTask(db3, task.id)!.status).toBe(TaskStatus.Completed);
    } finally {
      closeDatabase(db2);
      closeDatabase(db3);
    }
  });
});

// ---------------------------------------------------------------------------
// Inbox filtering accuracy
// ---------------------------------------------------------------------------

describe('inbox filtering', () => {
  it('filters by status correctly across all states', () => {
    // Create 5 tasks with different statuses
    const pending = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Pending task',
    });

    const active = createTask(db, {
      task_type: TaskType.Debug,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Active task',
    });
    updateTaskStatus(db, active.id, TaskStatus.Active);

    const waitingReply = createTask(db, {
      task_type: TaskType.Question,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Waiting reply task',
    });
    updateTaskStatus(db, waitingReply.id, TaskStatus.Active);
    updateTaskStatus(db, waitingReply.id, TaskStatus.WaitingReply);

    const completed = createTask(db, {
      task_type: TaskType.Test,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Completed task',
    });
    updateTaskStatus(db, completed.id, TaskStatus.Active);
    updateTaskStatus(db, completed.id, TaskStatus.Completed);

    const cancelled = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Cancelled task',
    });
    updateTaskStatus(db, cancelled.id, TaskStatus.Active);
    updateTaskStatus(db, cancelled.id, TaskStatus.Cancelled);

    // No filter returns all 5
    const all = getTasksByReceiver(db, 'agent-b');
    expect(all).toHaveLength(5);

    // Filter by specific statuses
    expect(getTasksByReceiver(db, 'agent-b', TaskStatus.Pending)).toHaveLength(1);
    expect(getTasksByReceiver(db, 'agent-b', TaskStatus.Active)).toHaveLength(1);
    expect(getTasksByReceiver(db, 'agent-b', TaskStatus.WaitingReply)).toHaveLength(1);
    expect(getTasksByReceiver(db, 'agent-b', TaskStatus.Completed)).toHaveLength(1);
    expect(getTasksByReceiver(db, 'agent-b', TaskStatus.Cancelled)).toHaveLength(1);

    // getActiveTasks returns non-terminal only (pending, active, waiting_reply)
    const activeTasks = getActiveTasks(db);
    expect(activeTasks).toHaveLength(3);
    const activeStatuses = activeTasks.map((t) => t.status);
    expect(activeStatuses).toContain(TaskStatus.Pending);
    expect(activeStatuses).toContain(TaskStatus.Active);
    expect(activeStatuses).toContain(TaskStatus.WaitingReply);
  });

  it('expired task disappears from active task list on read', () => {
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Will expire',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    // Before lazy expiration triggers, getActiveTasks reads and expires
    const activeBefore = getActiveTasks(db);
    expect(activeBefore.some((t) => t.id === task.id)).toBe(false);

    const fetched = getTask(db, task.id);
    expect(fetched!.status).toBe(TaskStatus.Expired);
  });
});

// ---------------------------------------------------------------------------
// Large content
// ---------------------------------------------------------------------------

describe('large content', () => {
  it('task with 10000-char summary stores and retrieves correctly', () => {
    const longSummary = 'A'.repeat(10_000);
    const task = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: longSummary,
    });

    const fetched = getTask(db, task.id);
    expect(fetched!.summary).toBe(longSummary);
    expect(fetched!.summary.length).toBe(10_000);
  });

  it('message with 100000-char body stores and retrieves correctly', () => {
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Large message test',
    });

    const longContent = 'B'.repeat(100_000);
    const msg = createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: longContent,
    });

    const msgs = getMessagesByTask(db, task.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe(longContent);
    expect(msgs[0].content.length).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Special characters in content
// ---------------------------------------------------------------------------

describe('special characters', () => {
  it('task summary with unicode and emoji is stored correctly', () => {
    const summary = '\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u043A\u0430 \u043A\u043E\u0434\u0443 \uD83D\uDD0D';
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary,
    });

    const fetched = getTask(db, task.id);
    expect(fetched!.summary).toBe(summary);
  });

  it('message body with SQL injection attempt is stored safely', () => {
    const task = createTask(db, {
      task_type: TaskType.Debug,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'SQL injection test',
    });

    const malicious = "'; DROP TABLE tasks; --";
    createMessage(db, {
      task_id: task.id,
      author: 'agent-a',
      kind: 'request',
      content: malicious,
    });

    // Table still exists and content is preserved
    const msgs = getMessagesByTask(db, task.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe(malicious);

    // Tasks table is still intact
    const allTasks = getActiveTasks(db);
    expect(allTasks.length).toBeGreaterThanOrEqual(1);
  });

  it('agent name with hyphens and numbers works', () => {
    upsertAgent(db, { name: 'agent-v2-test-123', role: 'tester', client: 'windsurf' });

    const task = createTask(db, {
      task_type: TaskType.Test,
      sender: 'agent-a',
      receiver: 'agent-v2-test-123',
      summary: 'Hyphenated agent test',
    });

    const inbox = getTasksByReceiver(db, 'agent-v2-test-123', TaskStatus.Pending);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].receiver).toBe('agent-v2-test-123');
  });

  it('summary with markdown is preserved exactly', () => {
    const summary = '# Review `auth.ts` **urgently**';
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary,
    });

    const fetched = getTask(db, task.id);
    expect(fetched!.summary).toBe(summary);
  });
});
