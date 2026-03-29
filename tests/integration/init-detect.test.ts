import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectClients, isCommandInPath } from '../../src/init/detector.js';
import { runInit } from '../../src/init/initializer.js';

let tmpDir: string;

function makeTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-init-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('detectClients', () => {
  it('finds .cursor/ directory', () => {
    const root = makeTmp();
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, '.cursor'));

    const clients = detectClients(root);
    const cursor = clients.find((c) => c.name === 'cursor');

    expect(cursor).toBeDefined();
    expect(cursor!.detected).toBe(true);
    expect(cursor!.reason).toContain('.cursor/');
  });

  it('detects cursor via binary even without .cursor/ directory', () => {
    const root = makeTmp();
    fs.mkdirSync(path.join(root, '.git'));

    const clients = detectClients(root);
    const cursor = clients.find((c) => c.name === 'cursor');

    // Cursor is detected via .cursor/ dir OR binary in PATH
    if (isCommandInPath('cursor')) {
      expect(cursor!.detected).toBe(true);
      expect(cursor!.reason).toContain('cursor binary in PATH');
    } else {
      expect(cursor!.detected).toBe(false);
      expect(cursor!.reason).toContain('not found');
    }
  });

  it('finds .codex/ directory', () => {
    const root = makeTmp();
    fs.mkdirSync(path.join(root, '.codex'));

    const clients = detectClients(root);
    const codex = clients.find((c) => c.name === 'codex');

    expect(codex).toBeDefined();
    expect(codex!.detected).toBe(true);
    expect(codex!.reason).toContain('.codex/');
  });
});

describe('init with cursor detected', () => {
  let originalCwd: string;

  afterEach(() => {
    // Restore cwd if changed
    if (originalCwd && process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  });

  function setupCursorProject(): string {
    const root = makeTmp();
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, '.cursor'));
    // Add a project marker so findProjectRoot works
    fs.writeFileSync(path.join(root, 'package.json'), '{}', 'utf-8');
    return root;
  }

  it('creates .cursor/mcp.json', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const mcpPath = path.join(root, '.cursor', 'mcp.json');
    expect(fs.existsSync(mcpPath)).toBe(true);
  });

  it('generated cursor MCP config has correct structure', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const mcpPath = path.join(root, '.cursor', 'mcp.json');
    const config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers['agent-bridge']).toBeDefined();
    expect(config.mcpServers['agent-bridge'].command).toBeDefined();
    expect(config.mcpServers['agent-bridge'].args).toBeInstanceOf(Array);
  });

  it('generated MCP config uses forward slashes', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const mcpPath = path.join(root, '.cursor', 'mcp.json');
    const content = fs.readFileSync(mcpPath, 'utf-8');

    expect(content).not.toContain('\\');
  });

  it('creates role prompt for detected client', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const promptPath = path.join(root, '.agents', 'agent-cursor.md');
    expect(fs.existsSync(promptPath)).toBe(true);
  });

  it('role prompt contains correct format', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const promptPath = path.join(root, '.agents', 'agent-cursor.md');
    const content = fs.readFileSync(promptPath, 'utf-8');

    expect(content).toContain('# Role:');
    expect(content).toContain('peer_send');
    expect(content).toContain('peer_inbox');
    expect(content).toContain('peer_reply');
    expect(content).toContain('## Collaboration Mode: Manual');
  });
});
