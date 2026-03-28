import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

import { runInit } from '../../src/init/initializer.js';
import { loadConfig } from '../../src/config/loader.js';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask } from '../../src/store/tasks.js';
import { getTask } from '../../src/store/tasks.js';
import { TaskType } from '../../src/domain/models.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-e2e-init-'));
  // Create a .git directory so findProjectRoot detects this as a project root
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('full init creates correct structure', () => {
  it('creates .agent-bridge directory', async () => {
    await runInit({ detect: false });

    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    expect(fs.existsSync(bridgeDir)).toBe(true);
    expect(fs.statSync(bridgeDir).isDirectory()).toBe(true);
  });

  it('creates valid config.yaml', async () => {
    await runInit({ detect: false });

    const configPath = path.join(tmpDir, '.agent-bridge', 'config.yaml');
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = YAML.parse(raw);

    expect(parsed.version).toBe(1);
    expect(parsed.policies).toBeDefined();
    expect(parsed.policies.blocked_patterns).toBeInstanceOf(Array);
    expect(parsed.expiration_minutes).toBeGreaterThan(0);
  });

  it('creates accessible bridge.db', async () => {
    await runInit({ detect: false });

    const dbPath = path.join(tmpDir, '.agent-bridge', 'bridge.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    // Verify it can be opened and queried
    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    const db = openDatabase(bridgeDir);
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('tasks');
      expect(names).toContain('messages');
      expect(names).toContain('agents');
    } finally {
      closeDatabase(db);
    }
  });

  it('updates .gitignore with bridge entries', async () => {
    await runInit({ detect: false });

    const gitignorePath = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.agent-bridge/bridge.db');
  });
});

describe('re-init preserves database', () => {
  it('keeps existing tasks after a second init', async () => {
    // First init
    await runInit({ detect: false });

    const bridgeDir = path.join(tmpDir, '.agent-bridge');

    // Insert a task directly into the database
    const db = openDatabase(bridgeDir);
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'test-sender',
      receiver: 'test-receiver',
      summary: 'Persist across re-init',
    });
    const taskId = task.id;
    closeDatabase(db);

    // Second init (not forced)
    await runInit({ detect: false });

    // Verify task still exists
    const db2 = openDatabase(bridgeDir);
    try {
      const fetched = getTask(db2, taskId);
      expect(fetched).not.toBeNull();
      expect(fetched!.summary).toBe('Persist across re-init');
    } finally {
      closeDatabase(db2);
    }
  });
});

describe('init with force overwrites configs', () => {
  it('resets config.yaml to defaults when force=true', async () => {
    // First init
    await runInit({ detect: false });

    const configPath = path.join(tmpDir, '.agent-bridge', 'config.yaml');

    // Modify config.yaml with custom content
    const customConfig = {
      version: 1,
      agents: [],
      policies: {
        blocked_patterns: ['**/*.custom'],
        max_artifact_size_kb: 9999,
      },
      expiration_minutes: 999,
    };
    fs.writeFileSync(configPath, YAML.stringify(customConfig), 'utf-8');

    // Verify the modification took effect
    const modified = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(modified.expiration_minutes).toBe(999);
    expect(modified.policies.max_artifact_size_kb).toBe(9999);

    // Re-init with force
    await runInit({ force: true, detect: false });

    // Verify config was reset to defaults
    const bridgeDir = path.join(tmpDir, '.agent-bridge');
    const config = loadConfig(bridgeDir);
    expect(config.expiration_minutes).toBe(30);
    expect(config.policies.max_artifact_size_kb).toBe(512);
    expect(config.policies.blocked_patterns).toContain('**/.env');
  });

  it('does not overwrite config.yaml without force', async () => {
    await runInit({ detect: false });

    const configPath = path.join(tmpDir, '.agent-bridge', 'config.yaml');

    // Modify config
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = YAML.parse(raw);
    parsed.expiration_minutes = 777;
    fs.writeFileSync(configPath, YAML.stringify(parsed), 'utf-8');

    // Re-init without force
    await runInit({ detect: false });

    // Config should still have our custom value
    const reloaded = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(reloaded.expiration_minutes).toBe(777);
  });
});
