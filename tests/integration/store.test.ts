import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask, getTask, getTasksByReceiver, updateTaskStatus, getActiveTasks, cleanupTasks } from '../../src/store/tasks.js';
import { createMessage, getMessagesByTask, getNewMessages, getMessageCount } from '../../src/store/messages.js';
import { copyArtifact, getArtifactsByTask, getArtifactsByMessage } from '../../src/store/artifacts.js';
import { upsertAgent, getAgent, getAgents, updateLastSeen, agentExists } from '../../src/store/agents.js';
import { TaskStatus, TaskType } from '../../src/domain/models.js';
import type { CreateTaskInput, CreateMessageInput } from '../../src/domain/models.js';
import { BridgeError, BridgeErrorCode } from '../../src/domain/errors.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTaskInput(overrides?: Partial<CreateTaskInput>): CreateTaskInput {
  return {
    task_type: TaskType.Review,
    sender: 'alice',
    receiver: 'bob',
    summary: 'Review the PR',
    ...overrides,
  };
}

describe('database', () => {
  it('opens and creates schema', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain('tasks');
    expect(names).toContain('messages');
    expect(names).toContain('artifacts');
    expect(names).toContain('agents');
    expect(names).toContain('schema_version');
  });

  it('migrations are idempotent (open twice)', () => {
    closeDatabase(db);
    db = openDatabase(bridgeDir);

    const version = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number };
    expect(version.version).toBe(1);
  });
});

describe('tasks', () => {
  it('createTask returns full task with pending status', () => {
    const task = createTask(db, makeTaskInput());

    expect(task.id).toBeDefined();
    expect(task.task_type).toBe(TaskType.Review);
    expect(task.sender).toBe('alice');
    expect(task.receiver).toBe('bob');
    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.summary).toBe('Review the PR');
    expect(task.created_at).toBeDefined();
    expect(task.updated_at).toBeDefined();
    expect(task.expires_at).toBeNull();
  });

  it('getTask retrieves by id', () => {
    const created = createTask(db, makeTaskInput());
    const fetched = getTask(db, created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.summary).toBe('Review the PR');
  });

  it('getTask returns null for unknown id', () => {
    const result = getTask(db, 'nonexistent-id');
    expect(result).toBeNull();
  });

  it('updateTaskStatus transitions pending -> active', () => {
    const task = createTask(db, makeTaskInput());
    const updated = updateTaskStatus(db, task.id, TaskStatus.Active);

    expect(updated.status).toBe(TaskStatus.Active);
    expect(updated.updated_at).toBeDefined();

    // Verify persisted in DB
    const fetched = getTask(db, task.id);
    expect(fetched!.status).toBe(TaskStatus.Active);
  });

  it('updateTaskStatus throws on invalid transition (pending -> completed)', () => {
    const task = createTask(db, makeTaskInput());

    expect(() => updateTaskStatus(db, task.id, TaskStatus.Completed)).toThrow(BridgeError);
    try {
      updateTaskStatus(db, task.id, TaskStatus.Completed);
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe(BridgeErrorCode.INVALID_TRANSITION);
    }
  });

  it('getTasksByReceiver filters correctly', () => {
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'charlie' }));

    const bobTasks = getTasksByReceiver(db, 'bob');
    const charlieTasks = getTasksByReceiver(db, 'charlie');

    expect(bobTasks).toHaveLength(2);
    expect(charlieTasks).toHaveLength(1);
  });

  it('getTasksByReceiver with status filter', () => {
    const t1 = createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    updateTaskStatus(db, t1.id, TaskStatus.Active);

    const activeTasks = getTasksByReceiver(db, 'bob', TaskStatus.Active);
    const pendingTasks = getTasksByReceiver(db, 'bob', TaskStatus.Pending);

    expect(activeTasks).toHaveLength(1);
    expect(pendingTasks).toHaveLength(1);
  });

  it('getActiveTasks excludes terminal states', () => {
    const t1 = createTask(db, makeTaskInput());
    const t2 = createTask(db, makeTaskInput());
    const t3 = createTask(db, makeTaskInput());

    updateTaskStatus(db, t1.id, TaskStatus.Active);
    updateTaskStatus(db, t1.id, TaskStatus.Completed);
    updateTaskStatus(db, t2.id, TaskStatus.Cancelled);

    const active = getActiveTasks(db);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(t3.id);
  });

  it('lazy expiration: getTask returns expired status for past expires_at', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const task = createTask(db, makeTaskInput({ expires_at: pastDate }));

    const fetched = getTask(db, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe(TaskStatus.Expired);
  });

  it('cleanupTasks soft: removes expired/cancelled', () => {
    const t1 = createTask(db, makeTaskInput());
    const t2 = createTask(db, makeTaskInput());
    const t3 = createTask(db, makeTaskInput());

    updateTaskStatus(db, t1.id, TaskStatus.Cancelled);
    // t2 expires lazily
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const t4 = createTask(db, makeTaskInput({ expires_at: pastDate }));
    // trigger lazy expiration so it becomes expired in db
    getTask(db, t4.id);

    cleanupTasks(db, false);

    expect(getTask(db, t1.id)).toBeNull();
    expect(getTask(db, t4.id)).toBeNull();
    expect(getTask(db, t2.id)).not.toBeNull();
    expect(getTask(db, t3.id)).not.toBeNull();
  });

  it('cleanupTasks hard: removes everything', () => {
    createTask(db, makeTaskInput());
    createTask(db, makeTaskInput());

    cleanupTasks(db, true);

    const active = getActiveTasks(db);
    expect(active).toHaveLength(0);
  });
});

describe('messages', () => {
  let taskId: string;

  beforeEach(() => {
    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    taskId = task.id;
  });

  it('createMessage and getMessagesByTask', () => {
    const input: CreateMessageInput = {
      task_id: taskId,
      author: 'alice',
      kind: 'request',
      content: 'Please review this',
    };
    const msg = createMessage(db, input);

    expect(msg.id).toBeDefined();
    expect(msg.task_id).toBe(taskId);
    expect(msg.author).toBe('alice');
    expect(msg.kind).toBe('request');
    expect(msg.content).toBe('Please review this');
    expect(msg.created_at).toBeDefined();

    const messages = getMessagesByTask(db, taskId);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it('getNewMessages filters by timestamp', async () => {
    const msg1 = createMessage(db, {
      task_id: taskId,
      author: 'alice',
      kind: 'request',
      content: 'First',
    });

    const cutoff = msg1.created_at;

    // Small delay to ensure a different timestamp
    await new Promise((resolve) => setTimeout(resolve, 15));

    createMessage(db, {
      task_id: taskId,
      author: 'bob',
      kind: 'reply',
      content: 'Second',
    });

    const newer = getNewMessages(db, taskId, cutoff);
    expect(newer).toHaveLength(1);
    expect(newer[0].content).toBe('Second');
  });

  it('getMessageCount returns correct count', () => {
    expect(getMessageCount(db, taskId)).toBe(0);

    createMessage(db, { task_id: taskId, author: 'alice', kind: 'note', content: 'a' });
    createMessage(db, { task_id: taskId, author: 'bob', kind: 'note', content: 'b' });

    expect(getMessageCount(db, taskId)).toBe(2);
  });
});

describe('artifacts', () => {
  let taskId: string;
  let messageId: string;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = path.join(tmpDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });

    const task = createTask(db, makeTaskInput());
    updateTaskStatus(db, task.id, TaskStatus.Active);
    taskId = task.id;

    const msg = createMessage(db, {
      task_id: taskId,
      author: 'alice',
      kind: 'request',
      content: 'Here is the file',
    });
    messageId = msg.id;
  });

  it('copyArtifact copies file and stores metadata', () => {
    const srcFile = path.join(projectRoot, 'hello.txt');
    fs.writeFileSync(srcFile, 'hello world');

    const artifact = copyArtifact(db, srcFile, taskId, messageId, bridgeDir, projectRoot);

    expect(artifact.id).toBeDefined();
    expect(artifact.task_id).toBe(taskId);
    expect(artifact.message_id).toBe(messageId);
    expect(artifact.filename).toBe('hello.txt');
    expect(artifact.type).toBe('txt');
    expect(artifact.size).toBe(11);
    expect(artifact.checksum).toBeDefined();
    expect(artifact.path).toContain('artifacts/');

    // Verify the file was actually copied
    const copiedPath = path.join(bridgeDir, artifact.path);
    expect(fs.existsSync(copiedPath)).toBe(true);
    expect(fs.readFileSync(copiedPath, 'utf-8')).toBe('hello world');
  });

  it('copyArtifact rejects blocked files (.env)', () => {
    const envFile = path.join(projectRoot, '.env');
    fs.writeFileSync(envFile, 'SECRET=value');

    expect(() =>
      copyArtifact(db, envFile, taskId, messageId, bridgeDir, projectRoot),
    ).toThrow(BridgeError);

    try {
      copyArtifact(db, envFile, taskId, messageId, bridgeDir, projectRoot);
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.BLOCKED_FILE);
    }
  });

  it('copyArtifact rejects oversized files', () => {
    const bigFile = path.join(projectRoot, 'big.bin');
    // Create a file just over the 1KB policy limit
    fs.writeFileSync(bigFile, Buffer.alloc(2048));

    expect(() =>
      copyArtifact(db, bigFile, taskId, messageId, bridgeDir, projectRoot, {
        maxArtifactSizeKb: 1,
      }),
    ).toThrow(BridgeError);

    try {
      copyArtifact(db, bigFile, taskId, messageId, bridgeDir, projectRoot, {
        maxArtifactSizeKb: 1,
      });
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.FILE_TOO_LARGE);
    }
  });

  it('copyArtifact rejects path escape (../)', () => {
    // Create a file outside the project root
    const outsideFile = path.join(tmpDir, 'outside.txt');
    fs.writeFileSync(outsideFile, 'escaped');

    expect(() =>
      copyArtifact(db, outsideFile, taskId, messageId, bridgeDir, projectRoot),
    ).toThrow(BridgeError);

    try {
      copyArtifact(db, outsideFile, taskId, messageId, bridgeDir, projectRoot);
    } catch (err) {
      expect((err as BridgeError).code).toBe(BridgeErrorCode.BLOCKED_FILE);
    }
  });

  it('getArtifactsByTask returns artifacts', () => {
    const f1 = path.join(projectRoot, 'a.txt');
    const f2 = path.join(projectRoot, 'b.txt');
    fs.writeFileSync(f1, 'aaa');
    fs.writeFileSync(f2, 'bbb');

    copyArtifact(db, f1, taskId, messageId, bridgeDir, projectRoot);
    copyArtifact(db, f2, taskId, messageId, bridgeDir, projectRoot);

    const artifacts = getArtifactsByTask(db, taskId);
    expect(artifacts).toHaveLength(2);

    const byMessage = getArtifactsByMessage(db, messageId);
    expect(byMessage).toHaveLength(2);
  });
});

describe('agents', () => {
  it('upsertAgent creates and retrieves', () => {
    const agent = upsertAgent(db, { name: 'cursor', role: 'coder', client: 'cursor-ai' });

    expect(agent.name).toBe('cursor');
    expect(agent.role).toBe('coder');
    expect(agent.client).toBe('cursor-ai');
    expect(agent.last_seen).toBeDefined();

    const fetched = getAgent(db, 'cursor');
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('cursor');
  });

  it('upsertAgent updates existing (role change)', () => {
    upsertAgent(db, { name: 'cursor', role: 'coder', client: 'cursor-ai' });
    const updated = upsertAgent(db, { name: 'cursor', role: 'reviewer', client: 'cursor-ai' });

    expect(updated.role).toBe('reviewer');

    const fetched = getAgent(db, 'cursor');
    expect(fetched!.role).toBe('reviewer');
  });

  it('getAgents returns all', () => {
    upsertAgent(db, { name: 'alice', role: 'coder', client: 'claude' });
    upsertAgent(db, { name: 'bob', role: 'reviewer', client: 'cursor' });

    const agents = getAgents(db);
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.name)).toEqual(['alice', 'bob']);
  });

  it('updateLastSeen changes timestamp', async () => {
    const agent = upsertAgent(db, { name: 'cursor', role: 'coder', client: 'cursor-ai' });
    const originalLastSeen = agent.last_seen;

    await new Promise((resolve) => setTimeout(resolve, 15));

    updateLastSeen(db, 'cursor');
    const fetched = getAgent(db, 'cursor');
    expect(fetched!.last_seen).not.toBe(originalLastSeen);
  });

  it('agentExists returns true/false', () => {
    expect(agentExists(db, 'ghost')).toBe(false);

    upsertAgent(db, { name: 'ghost', role: 'coder', client: 'test' });
    expect(agentExists(db, 'ghost')).toBe(true);
  });
});
