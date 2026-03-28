import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { detectClients, isCommandInPath } from '../../src/init/detector.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-detector-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectClients with .cursor/ dir', () => {
  it('detects cursor when .cursor/ directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });

    const clients = detectClients(tmpDir);
    const cursor = clients.find((c) => c.name === 'cursor');

    expect(cursor).toBeDefined();
    expect(cursor!.detected).toBe(true);
    expect(cursor!.reason).toContain('.cursor/ directory found');
  });
});

describe('detectClients without .cursor/', () => {
  it('does not detect cursor when .cursor/ is absent', () => {
    const clients = detectClients(tmpDir);
    const cursor = clients.find((c) => c.name === 'cursor');

    expect(cursor).toBeDefined();
    expect(cursor!.detected).toBe(false);
    expect(cursor!.reason).toContain('.cursor/ directory not found');
  });
});

describe('detectClients with .codex/ dir', () => {
  it('detects codex when .codex/ directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.codex'), { recursive: true });

    const clients = detectClients(tmpDir);
    const codex = clients.find((c) => c.name === 'codex');

    expect(codex).toBeDefined();
    expect(codex!.detected).toBe(true);
    expect(codex!.reason).toContain('.codex/ directory found');
  });
});

describe('default agent names', () => {
  it('cursor default agent name is cursor-dev', () => {
    const clients = detectClients(tmpDir);
    const cursor = clients.find((c) => c.name === 'cursor');
    expect(cursor!.defaultAgentName).toBe('cursor-dev');
  });

  it('claude-code default agent name is claude-reviewer', () => {
    const clients = detectClients(tmpDir);
    const claude = clients.find((c) => c.name === 'claude-code');
    expect(claude!.defaultAgentName).toBe('claude-reviewer');
  });

  it('codex default agent name is codex-tester', () => {
    const clients = detectClients(tmpDir);
    const codex = clients.find((c) => c.name === 'codex');
    expect(codex!.defaultAgentName).toBe('codex-tester');
  });
});

describe('default roles', () => {
  it('cursor default role is developer', () => {
    const clients = detectClients(tmpDir);
    const cursor = clients.find((c) => c.name === 'cursor');
    expect(cursor!.defaultRole).toBe('developer');
  });

  it('claude-code default role is reviewer', () => {
    const clients = detectClients(tmpDir);
    const claude = clients.find((c) => c.name === 'claude-code');
    expect(claude!.defaultRole).toBe('reviewer');
  });

  it('codex default role is tester', () => {
    const clients = detectClients(tmpDir);
    const codex = clients.find((c) => c.name === 'codex');
    expect(codex!.defaultRole).toBe('tester');
  });
});

describe('isCommandInPath', () => {
  it('finds node in PATH', () => {
    expect(isCommandInPath('node')).toBe(true);
  });

  it('does not find a nonexistent command', () => {
    expect(isCommandInPath('nonexistent-abc-xyz')).toBe(false);
  });
});
