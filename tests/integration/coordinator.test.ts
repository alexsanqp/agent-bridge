import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type BetterSqlite3 from 'better-sqlite3';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    on: vi.fn(),
  })),
}));

import { spawn } from 'node:child_process';
import { pollOnce, isCoordinatorRunning } from '../../src/commands/coordinator.js';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask } from '../../src/store/tasks.js';
import { upsertAgent } from '../../src/store/agents.js';
import { TaskType } from '../../src/domain/models.js';
import type { AgentConfig } from '../../src/config/loader.js';

const mockedSpawn = vi.mocked(spawn);

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;
let lastTriggered: Map<string, number>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-coord-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);
  lastTriggered = new Map();
  mockedSpawn.mockClear();
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return { name: 'agent-claude', role: 'coder', client: 'claude-code', enabled: true, ...overrides };
}

function createPendingTask(receiver: string): void {
  createTask(db, { task_type: TaskType.Review, sender: 'orchestrator', receiver, summary: 'Test' });
}

describe('coordinator pollOnce', () => {
  it('triggers claude-code with /peer-collaborate', () => {
    const agent = makeAgent();
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).toHaveBeenCalledOnce();
    expect(mockedSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '/peer-collaborate', '--continue'],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('triggers codex with /peer-collaborate', () => {
    const agent = makeAgent({ name: 'agent-codex', client: 'codex' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-codex');

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).toHaveBeenCalledOnce();
    expect(mockedSpawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '/peer-collaborate'],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('does NOT trigger when no pending tasks', () => {
    const agent = makeAgent();
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('skips cursor — no local trigger', () => {
    const agent = makeAgent({ name: 'agent-cursor', client: 'cursor' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-cursor');

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('respects cooldown', () => {
    const agent = makeAgent();
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);
    expect(mockedSpawn).toHaveBeenCalledOnce();

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);
    expect(mockedSpawn).toHaveBeenCalledOnce(); // not called again
  });

  it('triggers after cooldown expires', () => {
    const agent = makeAgent();
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');
    lastTriggered.set('agent-claude', Date.now() - 60000);

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('skips disabled agents', () => {
    const agent = makeAgent({ enabled: false });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    pollOnce(db, [agent], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('triggers multiple agents', () => {
    const claude = makeAgent();
    const codex = makeAgent({ name: 'agent-codex', client: 'codex' });
    upsertAgent(db, { name: claude.name, role: claude.role, client: claude.client });
    upsertAgent(db, { name: codex.name, role: codex.role, client: codex.client });
    createPendingTask('agent-claude');
    createPendingTask('agent-codex');

    pollOnce(db, [claude, codex], 30000, lastTriggered, tmpDir, false);

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });
});

describe('PID file management', () => {
  it('returns false when no PID file', () => {
    expect(isCoordinatorRunning(bridgeDir)).toBe(false);
  });

  it('returns false for stale PID file', () => {
    fs.writeFileSync(path.join(bridgeDir, 'coordinator.pid'), '999999999', 'utf-8');
    expect(isCoordinatorRunning(bridgeDir)).toBe(false);
  });

  it('returns true for current process PID', () => {
    fs.writeFileSync(path.join(bridgeDir, 'coordinator.pid'), String(process.pid), 'utf-8');
    expect(isCoordinatorRunning(bridgeDir)).toBe(true);
  });
});
