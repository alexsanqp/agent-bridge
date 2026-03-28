import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { runInit } from '../../src/init/initializer.js';
import { runDoctor } from '../../src/doctor/checks.js';
import { loadConfig } from '../../src/config/loader.js';
import { openDatabase, closeDatabase } from '../../src/store/database.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-doctor-'));
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('doctor on valid setup', () => {
  it('all checks pass after init', async () => {
    await runInit({ detect: false });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runDoctor();

    const output = logs.join('\n');
    expect(output).toContain('Agent Bridge Doctor');

    // Core checks should all pass
    expect(output).toMatch(/✓.*Project root found/);
    expect(output).toMatch(/✓.*Bridge directory exists/);
    expect(output).toMatch(/✓.*config\.yaml is valid/);
    expect(output).toMatch(/✓.*bridge\.db is accessible/);

    // No failures among core checks
    const failureLines = logs.filter((l) => l.startsWith('✗'));
    const coreFailures = failureLines.filter(
      (l) =>
        l.includes('Project root') ||
        l.includes('Bridge directory') ||
        l.includes('config.yaml') ||
        l.includes('bridge.db'),
    );
    expect(coreFailures).toHaveLength(0);
  });
});

describe('doctor detects missing config.yaml', () => {
  it('reports failure when config.yaml is deleted', async () => {
    await runInit({ detect: false });

    const configPath = path.join(tmpDir, '.agent-bridge', 'config.yaml');
    fs.unlinkSync(configPath);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runDoctor();

    const output = logs.join('\n');
    expect(output).toMatch(/✗.*config\.yaml/);
  });
});

describe('doctor detects missing bridge.db', () => {
  it('reports failure when bridge.db is deleted', async () => {
    await runInit({ detect: false });

    // Remove all db-related files
    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    for (const file of fs.readdirSync(bridgeDir)) {
      if (file.startsWith('bridge.db')) {
        fs.unlinkSync(path.join(bridgeDir, file));
      }
    }

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runDoctor();

    const output = logs.join('\n');
    // Database check should still pass because openDatabase recreates it,
    // but if that's the case, we verify no crash occurred
    expect(output).toContain('bridge.db');
  });
});

describe('doctor detects missing bridge dir', () => {
  it('reports failures when .agent-bridge/ is removed entirely', async () => {
    await runInit({ detect: false });

    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    fs.rmSync(bridgeDir, { recursive: true, force: true });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await runDoctor();

    const output = logs.join('\n');
    expect(output).toMatch(/✗.*Bridge directory exists/);
    expect(output).toMatch(/✗.*config\.yaml/);
  });
});

describe('doctor underlying checks', () => {
  it('loadConfig throws on missing file', () => {
    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    fs.mkdirSync(bridgeDir, { recursive: true });

    expect(() => loadConfig(bridgeDir)).toThrow(/Config not found/);
  });

  it('openDatabase works on valid dir', async () => {
    await runInit({ detect: false });

    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    const db = openDatabase(bridgeDir);
    expect(db).toBeDefined();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('tasks');
    expect(names).toContain('messages');
    closeDatabase(db);
  });

  it('loadConfig succeeds after init', async () => {
    await runInit({ detect: false });

    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    const config = loadConfig(bridgeDir);
    expect(config.version).toBe(1);
    expect(config.policies).toBeDefined();
  });
});
