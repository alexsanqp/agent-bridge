import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import path from 'node:path';
import { ensureDir } from '../utils/paths.js';

export type { BetterSqlite3 };

interface Migration {
  version: number;
  apply: (db: BetterSqlite3.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id          TEXT PRIMARY KEY,
          task_type   TEXT NOT NULL,
          sender      TEXT NOT NULL,
          receiver    TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending',
          summary     TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          expires_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
          id          TEXT PRIMARY KEY,
          task_id     TEXT NOT NULL REFERENCES tasks(id),
          author      TEXT NOT NULL,
          kind        TEXT NOT NULL,
          content     TEXT NOT NULL,
          created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          id          TEXT PRIMARY KEY,
          task_id     TEXT NOT NULL REFERENCES tasks(id),
          message_id  TEXT NOT NULL REFERENCES messages(id),
          filename    TEXT NOT NULL,
          type        TEXT NOT NULL,
          size        INTEGER NOT NULL,
          checksum    TEXT NOT NULL,
          path        TEXT NOT NULL,
          created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agents (
          name        TEXT PRIMARY KEY,
          role        TEXT NOT NULL,
          client      TEXT NOT NULL,
          last_seen   TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_receiver_status ON tasks(receiver, status);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
        CREATE INDEX IF NOT EXISTS idx_artifacts_task_id ON artifacts(task_id);
      `);
    },
  },
];

export function runMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersion =
    db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
      | { version: number | null }
      | undefined;

  const appliedVersion = currentVersion?.version ?? 0;

  for (const migration of migrations) {
    if (migration.version > appliedVersion) {
      db.transaction(() => {
        migration.apply(db);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString(),
        );
      })();
    }
  }
}

export function openDatabase(bridgeDir: string): BetterSqlite3.Database {
  ensureDir(bridgeDir);

  const dbPath = path.join(bridgeDir, 'bridge.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  return db;
}

export function closeDatabase(db: BetterSqlite3.Database): void {
  db.close();
}
