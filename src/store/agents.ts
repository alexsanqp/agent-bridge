import type BetterSqlite3 from 'better-sqlite3';
import { Agent } from '../domain/models.js';
import { now } from '../utils/time.js';

export function upsertAgent(
  db: BetterSqlite3.Database,
  agent: { name: string; role: string; client: string },
): Agent {
  const lastSeen = now();

  db.prepare(
    `INSERT INTO agents (name, role, client, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET role = excluded.role, client = excluded.client, last_seen = excluded.last_seen`,
  ).run(agent.name, agent.role, agent.client, lastSeen);

  return {
    name: agent.name,
    role: agent.role,
    client: agent.client,
    last_seen: lastSeen,
  };
}

export function getAgent(
  db: BetterSqlite3.Database,
  name: string,
): Agent | null {
  const row = db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as Agent | undefined;
  return row ?? null;
}

export function getAgents(db: BetterSqlite3.Database): Agent[] {
  return db.prepare('SELECT * FROM agents ORDER BY name').all() as Agent[];
}

export function updateLastSeen(
  db: BetterSqlite3.Database,
  name: string,
): void {
  db.prepare('UPDATE agents SET last_seen = ? WHERE name = ?').run(now(), name);
}

export function agentExists(
  db: BetterSqlite3.Database,
  name: string,
): boolean {
  const row = db.prepare('SELECT 1 FROM agents WHERE name = ?').get(name);
  return row !== undefined;
}
