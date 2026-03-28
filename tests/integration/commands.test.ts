import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { openDatabase, closeDatabase } from '../../src/store/database.js';
import {
  createTask,
  getTask,
  getActiveTasks,
  getTasksByReceiver,
  cleanupTasks,
  updateTaskStatus,
} from '../../src/store/tasks.js';
import { upsertAgent, getAgents } from '../../src/store/agents.js';
import { TaskStatus, TaskType } from '../../src/domain/models.js';
import type { CreateTaskInput } from '../../src/domain/models.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cmd-test-'));
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

describe('status command logic', () => {
  it('shows 0 active tasks on empty db', () => {
    const activeTasks = getActiveTasks(db);
    expect(activeTasks).toHaveLength(0);
  });

  it('shows correct active task count after creating tasks', () => {
    createTask(db, makeTaskInput());
    createTask(db, makeTaskInput());
    const t3 = createTask(db, makeTaskInput());
    updateTaskStatus(db, t3.id, TaskStatus.Cancelled);

    const activeTasks = getActiveTasks(db);
    expect(activeTasks).toHaveLength(2);
  });

  it('shows pending inbox count per agent', () => {
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'charlie' }));

    const t4 = createTask(db, makeTaskInput({ receiver: 'bob' }));
    updateTaskStatus(db, t4.id, TaskStatus.Active);

    const bobPending = getTasksByReceiver(db, 'bob', TaskStatus.Pending);
    const charliePending = getTasksByReceiver(db, 'charlie', TaskStatus.Pending);

    expect(bobPending).toHaveLength(2);
    expect(charliePending).toHaveLength(1);
  });

  it('shows known agents with last_seen', () => {
    upsertAgent(db, { name: 'cursor', role: 'coder', client: 'cursor-ai' });
    upsertAgent(db, { name: 'claude', role: 'reviewer', client: 'claude-code' });

    const agents = getAgents(db);
    expect(agents).toHaveLength(2);

    for (const agent of agents) {
      expect(agent.name).toBeDefined();
      expect(agent.role).toBeDefined();
      expect(agent.last_seen).toBeDefined();
      expect(() => new Date(agent.last_seen)).not.toThrow();
    }
  });
});

describe('tasks command logic', () => {
  it('lists all active tasks when no filters', () => {
    createTask(db, makeTaskInput({ summary: 'task-1' }));
    createTask(db, makeTaskInput({ summary: 'task-2' }));
    const t3 = createTask(db, makeTaskInput({ summary: 'task-3' }));
    updateTaskStatus(db, t3.id, TaskStatus.Cancelled);

    const tasks = getActiveTasks(db);
    expect(tasks).toHaveLength(2);
  });

  it('filters by status', () => {
    const t1 = createTask(db, makeTaskInput());
    createTask(db, makeTaskInput());
    updateTaskStatus(db, t1.id, TaskStatus.Active);

    const rows = db
      .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC')
      .all(TaskStatus.Active) as Array<{ status: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(TaskStatus.Active);
  });

  it('filters by agent (receiver)', () => {
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'charlie' }));

    const bobTasks = getTasksByReceiver(db, 'bob');
    expect(bobTasks).toHaveLength(2);
  });

  it('combined status and agent filter', () => {
    const t1 = createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'bob' }));
    createTask(db, makeTaskInput({ receiver: 'charlie' }));
    updateTaskStatus(db, t1.id, TaskStatus.Active);

    const bobActive = getTasksByReceiver(db, 'bob', TaskStatus.Active);
    expect(bobActive).toHaveLength(1);
    expect(bobActive[0].id).toBe(t1.id);
  });

  it('empty result when no tasks match', () => {
    createTask(db, makeTaskInput({ receiver: 'bob' }));

    const result = getTasksByReceiver(db, 'nobody');
    expect(result).toHaveLength(0);
  });

  it('lazy expiration: expired task does not show as active', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const t1 = createTask(db, makeTaskInput({ expires_at: pastDate }));
    createTask(db, makeTaskInput());

    // getTask triggers lazy expiration
    const fetched = getTask(db, t1.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe(TaskStatus.Expired);

    // After lazy expiration, getActiveTasks should exclude it
    const active = getActiveTasks(db);
    expect(active).toHaveLength(1);
  });
});

describe('reset command logic', () => {
  it('soft reset: removes expired and cancelled tasks, keeps active ones', () => {
    const t1 = createTask(db, makeTaskInput());
    const t2 = createTask(db, makeTaskInput());
    const t3 = createTask(db, makeTaskInput());

    updateTaskStatus(db, t1.id, TaskStatus.Cancelled);

    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const t4 = createTask(db, makeTaskInput({ expires_at: pastDate }));
    // Trigger lazy expiration
    getTask(db, t4.id);

    cleanupTasks(db, false);

    expect(getTask(db, t1.id)).toBeNull();
    expect(getTask(db, t4.id)).toBeNull();
    expect(getTask(db, t2.id)).not.toBeNull();
    expect(getTask(db, t3.id)).not.toBeNull();
  });

  it('hard reset: removes all tasks, messages, and artifacts from DB', () => {
    createTask(db, makeTaskInput());
    createTask(db, makeTaskInput());
    createTask(db, makeTaskInput());

    cleanupTasks(db, true);

    const count = (
      db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }
    ).count;
    expect(count).toBe(0);

    const msgCount = (
      db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
    ).count;
    expect(msgCount).toBe(0);

    const artCount = (
      db.prepare('SELECT COUNT(*) as count FROM artifacts').get() as { count: number }
    ).count;
    expect(artCount).toBe(0);
  });

  it('hard reset: bridge.db file can be deleted after close', () => {
    createTask(db, makeTaskInput());

    cleanupTasks(db, true);
    closeDatabase(db);

    const dbPath = path.join(bridgeDir, 'bridge.db');
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    expect(fs.existsSync(dbPath)).toBe(false);

    // Re-open for afterEach cleanup
    db = openDatabase(bridgeDir);
  });

  it('hard reset: artifacts directory can be deleted', () => {
    const artifactsDir = path.join(bridgeDir, 'artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, 'test.txt'), 'content');

    expect(fs.existsSync(artifactsDir)).toBe(true);

    fs.rmSync(artifactsDir, { recursive: true, force: true });

    expect(fs.existsSync(artifactsDir)).toBe(false);
  });
});
