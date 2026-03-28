import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask, getTask, getTasksByReceiver } from '../../src/store/tasks.js';
import { createMessage, getMessagesByTask, getMessageCount } from '../../src/store/messages.js';
import { upsertAgent, getAgent } from '../../src/store/agents.js';
import { TaskType, TaskStatus } from '../../src/domain/models.js';
import type { CreateTaskInput } from '../../src/domain/models.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let connections: BetterSqlite3.Database[];

function makeTaskInput(overrides?: Partial<CreateTaskInput>): CreateTaskInput {
  return {
    task_type: TaskType.Review,
    sender: 'agent-a',
    receiver: 'agent-b',
    summary: 'Concurrent test task',
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-concurrent-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  connections = [];
});

afterEach(() => {
  for (const conn of connections) {
    closeDatabase(conn);
  }
  connections = [];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function openConn(): BetterSqlite3.Database {
  const db = openDatabase(bridgeDir);
  connections.push(db);
  return db;
}

describe('concurrent access (m-13)', () => {
  it('3 agents writing tasks simultaneously', async () => {
    const db1 = openConn();
    const db2 = openConn();
    const db3 = openConn();

    const writers = [db1, db2, db3].map((db, idx) =>
      Promise.resolve().then(() => {
        const tasks = [];
        for (let i = 0; i < 10; i++) {
          tasks.push(
            createTask(db, makeTaskInput({
              sender: `writer-${idx}`,
              summary: `Task ${i} from writer ${idx}`,
            })),
          );
        }
        return tasks;
      }),
    );

    const results = await Promise.all(writers);
    const allCreatedTasks = results.flat();
    expect(allCreatedTasks).toHaveLength(30);

    // Verify all 30 tasks exist via a single connection
    const verifyDb = openConn();
    for (const task of allCreatedTasks) {
      const fetched = getTask(verifyDb, task.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(task.id);
    }

    // Verify total count via receiver
    const allByReceiver = getTasksByReceiver(verifyDb, 'agent-b');
    expect(allByReceiver).toHaveLength(30);
  });

  it('concurrent reads and writes cause no corruption', async () => {
    const writerDb = openConn();
    const readerDb = openConn();

    const createdIds: string[] = [];

    const writePromise = Promise.resolve().then(() => {
      for (let i = 0; i < 20; i++) {
        const task = createTask(writerDb, makeTaskInput({
          summary: `Write task ${i}`,
        }));
        createdIds.push(task.id);
      }
    });

    const readPromise = Promise.resolve().then(() => {
      const results: Array<{ id: string } | null> = [];
      // Read tasks that may or may not exist yet
      for (let i = 0; i < 20; i++) {
        const tasks = getTasksByReceiver(readerDb, 'agent-b');
        for (const t of tasks) {
          results.push(t);
        }
      }
      return results;
    });

    await Promise.all([writePromise, readPromise]);

    // After both complete, verify all tasks are readable and consistent
    for (const id of createdIds) {
      const task = getTask(readerDb, id);
      expect(task).not.toBeNull();
      expect(task!.status).toBe(TaskStatus.Pending);
      expect(task!.receiver).toBe('agent-b');
    }
  });

  it('message creation under contention', async () => {
    const setupDb = openConn();
    const task = createTask(setupDb, makeTaskInput());

    const db1 = openConn();
    const db2 = openConn();
    const db3 = openConn();

    const messagesPerWriter = 5;

    const writers = [db1, db2, db3].map((db, idx) =>
      Promise.resolve().then(() => {
        for (let i = 0; i < messagesPerWriter; i++) {
          createMessage(db, {
            task_id: task.id,
            author: `agent-${idx}`,
            kind: 'note',
            content: `Message ${i} from agent-${idx}`,
          });
        }
      }),
    );

    await Promise.all(writers);

    // Verify all messages exist
    const verifyDb = openConn();
    const messages = getMessagesByTask(verifyDb, task.id);
    expect(messages).toHaveLength(messagesPerWriter * 3);

    const count = getMessageCount(verifyDb, task.id);
    expect(count).toBe(messagesPerWriter * 3);

    // Verify each author has the correct number of messages
    for (let idx = 0; idx < 3; idx++) {
      const authorMessages = messages.filter((m) => m.author === `agent-${idx}`);
      expect(authorMessages).toHaveLength(messagesPerWriter);
    }
  });

  it('agent upsert contention produces no duplicates', async () => {
    const db1 = openConn();
    const db2 = openConn();
    const db3 = openConn();

    const agentName = 'shared-agent';
    const roles = ['developer', 'reviewer', 'tester'];

    const writers = [db1, db2, db3].map((db, idx) =>
      Promise.resolve().then(() => {
        for (let i = 0; i < 5; i++) {
          upsertAgent(db, {
            name: agentName,
            role: roles[idx],
            client: `client-${idx}`,
          });
        }
      }),
    );

    await Promise.all(writers);

    // Verify exactly one agent record exists (no duplicates)
    const verifyDb = openConn();
    const agent = getAgent(verifyDb, agentName);
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe(agentName);

    // Last write wins: role should be one of the three
    expect(roles).toContain(agent!.role);

    // Verify no duplicates by querying directly
    const rows = verifyDb
      .prepare('SELECT COUNT(*) as count FROM agents WHERE name = ?')
      .get(agentName) as { count: number };
    expect(rows.count).toBe(1);
  });
});
