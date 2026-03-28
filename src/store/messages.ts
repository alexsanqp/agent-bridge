import type BetterSqlite3 from 'better-sqlite3';
import { Message, CreateMessageInput } from '../domain/models.js';
import { generateId } from '../utils/ids.js';
import { now } from '../utils/time.js';

export function createMessage(db: BetterSqlite3.Database, input: CreateMessageInput): Message {
  const message: Message = {
    id: generateId(),
    task_id: input.task_id,
    author: input.author,
    kind: input.kind,
    content: input.content,
    created_at: now(),
  };

  db.prepare(
    `INSERT INTO messages (id, task_id, author, kind, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.task_id,
    message.author,
    message.kind,
    message.content,
    message.created_at,
  );

  return message;
}

export function getMessagesByTask(db: BetterSqlite3.Database, taskId: string): Message[] {
  return db
    .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as Message[];
}

export function getNewMessages(
  db: BetterSqlite3.Database,
  taskId: string,
  afterTimestamp: string,
): Message[] {
  return db
    .prepare('SELECT * FROM messages WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC')
    .all(taskId, afterTimestamp) as Message[];
}

export function getMessageCount(db: BetterSqlite3.Database, taskId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE task_id = ?')
    .get(taskId) as { count: number };
  return row.count;
}
