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
  execFileSync: vi.fn(() => JSON.stringify({ session_id: 'test-session-123', result: 'OK' })),
}));

import { execFileSync } from 'node:child_process';
import { pollOnce } from '../../src/commands/coordinator.js';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask } from '../../src/store/tasks.js';
import { upsertAgent } from '../../src/store/agents.js';
import { TaskType } from '../../src/domain/models.js';
import type { AgentConfig } from '../../src/config/loader.js';

const mockedExecFileSync = vi.mocked(execFileSync);

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;
let lastTriggered: Map<string, number>;
let sessionStore: Map<string, string>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-coord-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);
  lastTriggered = new Map();
  sessionStore = new Map();
  mockedExecFileSync.mockClear();
  mockedExecFileSync.mockReturnValue(JSON.stringify({ session_id: 'test-session-123', result: 'OK' }));
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'agent-claude',
    role: 'coder',
    client: 'claude-code',
    enabled: true,
    ...overrides,
  };
}

function createPendingTask(receiver: string): void {
  createTask(db, {
    task_type: TaskType.Review,
    sender: 'orchestrator',
    receiver,
    summary: 'Test task',
  });
}

describe('coordinator pollOnce', () => {
  it('triggers claude-code agent when pending tasks exist', () => {
    const agent = makeAgent({ name: 'agent-claude', client: 'claude-code' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).toHaveBeenCalledOnce();
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', expect.stringContaining('peer_inbox')]),
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('triggers codex agent when pending tasks exist', () => {
    const agent = makeAgent({ name: 'agent-codex', client: 'codex' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-codex');

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).toHaveBeenCalledOnce();
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', expect.stringContaining('peer_inbox')]),
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('does NOT trigger when no pending tasks', () => {
    const agent = makeAgent({ name: 'agent-claude' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('does NOT trigger cursor agent and logs warning', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const agent = makeAgent({ name: 'agent-cursor', client: 'cursor' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-cursor');

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).not.toHaveBeenCalled();
    const logMessages = logSpy.mock.calls.map((call) => call[0]);
    expect(logMessages.some((msg) => typeof msg === 'string' && msg.includes('not supported'))).toBe(true);
  });

  it('respects cooldown — no re-trigger within cooldown period', () => {
    const agent = makeAgent({ name: 'agent-claude' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);
    expect(mockedExecFileSync).toHaveBeenCalledOnce();

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);
    expect(mockedExecFileSync).toHaveBeenCalledOnce(); // still 1, not 2
  });

  it('triggers after cooldown expires', () => {
    const agent = makeAgent({ name: 'agent-claude' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    lastTriggered.set('agent-claude', Date.now() - 60000);

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).toHaveBeenCalledOnce();
  });

  it('skips disabled agents', () => {
    const agent = makeAgent({ name: 'agent-claude', enabled: false });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('handles multiple agents correctly', () => {
    const claude = makeAgent({ name: 'agent-claude', client: 'claude-code' });
    const codex = makeAgent({ name: 'agent-codex', client: 'codex' });
    upsertAgent(db, { name: claude.name, role: claude.role, client: claude.client });
    upsertAgent(db, { name: codex.name, role: codex.role, client: codex.client });
    createPendingTask('agent-claude');
    createPendingTask('agent-codex');

    pollOnce(db, [claude, codex], 30000, lastTriggered, sessionStore, tmpDir, false);

    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
    const commands = mockedExecFileSync.mock.calls.map((call) => call[0]);
    expect(commands).toContain('claude');
    expect(commands).toContain('codex');
  });

  it('captures and reuses session ID on subsequent triggers', () => {
    const agent = makeAgent({ name: 'agent-claude', client: 'claude-code' });
    upsertAgent(db, { name: agent.name, role: agent.role, client: agent.client });
    createPendingTask('agent-claude');

    // First trigger — no session yet
    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);
    expect(sessionStore.get('agent-claude')).toBe('test-session-123');

    // Reset cooldown and trigger again — should use --resume
    lastTriggered.set('agent-claude', Date.now() - 60000);
    pollOnce(db, [agent], 30000, lastTriggered, sessionStore, tmpDir, false);

    const secondCall = mockedExecFileSync.mock.calls[1];
    expect(secondCall[1]).toContain('--resume');
    expect(secondCall[1]).toContain('test-session-123');
  });
});
