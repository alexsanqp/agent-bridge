import type BetterSqlite3 from 'better-sqlite3';
import { Task, TaskStatus, CreateTaskInput } from '../domain/models.js';
import { validateTransition } from '../domain/status.js';
import { BridgeError, BridgeErrorCode } from '../domain/errors.js';
import { generateId } from '../utils/ids.js';
import { now, isExpired } from '../utils/time.js';

function applyLazyExpiration(db: BetterSqlite3.Database, task: Task): Task {
  if (task.expires_at && isExpired(task.expires_at) && task.status !== TaskStatus.Expired) {
    const timestamp = now();
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(
      TaskStatus.Expired,
      timestamp,
      task.id,
    );
    return { ...task, status: TaskStatus.Expired, updated_at: timestamp };
  }
  return task;
}

export function createTask(db: BetterSqlite3.Database, input: CreateTaskInput): Task {
  const task: Task = {
    id: generateId(),
    task_type: input.task_type,
    sender: input.sender,
    receiver: input.receiver,
    status: TaskStatus.Pending,
    summary: input.summary,
    created_at: now(),
    updated_at: now(),
    expires_at: input.expires_at ?? null,
  };

  db.prepare(
    `INSERT INTO tasks (id, task_type, sender, receiver, status, summary, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    task.id,
    task.task_type,
    task.sender,
    task.receiver,
    task.status,
    task.summary,
    task.created_at,
    task.updated_at,
    task.expires_at,
  );

  return task;
}

export function getTask(db: BetterSqlite3.Database, id: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  if (!row) return null;
  return applyLazyExpiration(db, row);
}

export function getTasksByReceiver(
  db: BetterSqlite3.Database,
  receiver: string,
  status?: TaskStatus,
): Task[] {
  let rows: Task[];

  if (status !== undefined) {
    rows = db
      .prepare('SELECT * FROM tasks WHERE receiver = ? AND status = ?')
      .all(receiver, status) as Task[];
  } else {
    rows = db
      .prepare('SELECT * FROM tasks WHERE receiver = ?')
      .all(receiver) as Task[];
  }

  return rows.reduce<Task[]>((result, row) => {
    const task = applyLazyExpiration(db, row);
    if (status === undefined || task.status === status) {
      result.push(task);
    }
    return result;
  }, []);
}

export function updateTaskStatus(
  db: BetterSqlite3.Database,
  id: string,
  newStatus: TaskStatus,
): Task {
  const task = getTask(db, id);

  if (!task) {
    throw new BridgeError(BridgeErrorCode.TASK_NOT_FOUND, `Task ${id} not found`);
  }

  if (!validateTransition(task.status, newStatus)) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_TRANSITION,
      `Cannot transition from ${task.status} to ${newStatus}`,
      { from: task.status, to: newStatus },
    );
  }

  const timestamp = now();
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(
    newStatus,
    timestamp,
    id,
  );

  return { ...task, status: newStatus, updated_at: timestamp };
}

export function getActiveTasks(db: BetterSqlite3.Database): Task[] {
  return db
    .prepare(
      `SELECT * FROM tasks WHERE status NOT IN ('completed', 'failed', 'cancelled', 'expired')`,
    )
    .all() as Task[];
}

export function cleanupTasks(db: BetterSqlite3.Database, hard: boolean): void {
  if (hard) {
    db.prepare('DELETE FROM artifacts').run();
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM tasks').run();
  } else {
    const terminalStatuses = [TaskStatus.Expired, TaskStatus.Cancelled];
    const placeholders = terminalStatuses.map(() => '?').join(', ');

    const taskIds = db
      .prepare(`SELECT id FROM tasks WHERE status IN (${placeholders})`)
      .all(...terminalStatuses) as Array<{ id: string }>;

    if (taskIds.length > 0) {
      const ids = taskIds.map((r) => r.id);
      const idPlaceholders = ids.map(() => '?').join(', ');

      db.prepare(`DELETE FROM artifacts WHERE task_id IN (${idPlaceholders})`).run(...ids);
      db.prepare(`DELETE FROM messages WHERE task_id IN (${idPlaceholders})`).run(...ids);
      db.prepare(`DELETE FROM tasks WHERE id IN (${idPlaceholders})`).run(...ids);
    }
  }
}
