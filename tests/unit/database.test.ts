import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-db-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);
});

afterEach(() => {
  try {
    closeDatabase(db);
  } catch {
    // already closed in some tests
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('creates bridge.db file in specified directory', () => {
    const dbFile = path.join(bridgeDir, 'bridge.db');
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  it('sets WAL journal mode', () => {
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('wal');
  });

  it('sets busy_timeout to 3000', () => {
    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(row.timeout).toBe(3000);
  });

  it('enables foreign keys', () => {
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it('sets synchronous to NORMAL', () => {
    const row = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
    // NORMAL = 1
    expect(row.synchronous).toBe(1);
  });

  it('creates all required tables', () => {
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

  it('creates all required indexes', () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);

    expect(names).toContain('idx_tasks_receiver_status');
    expect(names).toContain('idx_tasks_status');
    expect(names).toContain('idx_messages_task_id');
    expect(names).toContain('idx_artifacts_task_id');
  });

  it('is idempotent — opening twice on same directory causes no errors', () => {
    closeDatabase(db);
    const db2 = openDatabase(bridgeDir);
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('tasks');
    db = db2; // reassign so afterEach closes this one
  });
});

describe('closeDatabase', () => {
  it('closes without error', () => {
    expect(() => closeDatabase(db)).not.toThrow();
  });

  it('closed DB cannot be queried', () => {
    closeDatabase(db);
    expect(() => db.prepare('SELECT 1').get()).toThrow();
  });
});

describe('schema_version', () => {
  it('records version 1 after migration', () => {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
      version: number;
    };
    expect(row.version).toBe(1);
  });

  it('has correct structure — only version column', () => {
    const columns = db.prepare("PRAGMA table_info('schema_version')").all() as Array<{
      name: string;
    }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual(['version']);
  });
});
