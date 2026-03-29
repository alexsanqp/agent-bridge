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

  it('creates skill files in both .agents/skills/ and .claude/skills/', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const agentsSkillPath = path.join(root, '.agents', 'skills', 'peer-collaborate', 'SKILL.md');
    const claudeSkillPath = path.join(root, '.claude', 'skills', 'peer-collaborate', 'SKILL.md');

    expect(fs.existsSync(agentsSkillPath)).toBe(true);
    expect(fs.existsSync(claudeSkillPath)).toBe(true);

    const agentsContent = fs.readFileSync(agentsSkillPath, 'utf-8');
    const claudeContent = fs.readFileSync(claudeSkillPath, 'utf-8');
    expect(agentsContent).toBe(claudeContent);
  });

  it('skill file contains frontmatter and tools', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const skillPath = path.join(root, '.agents', 'skills', 'peer-collaborate', 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf-8');

    expect(content).toContain('name: peer-collaborate');
    expect(content).toContain('peer_send');
    expect(content).toContain('peer_inbox');
    expect(content).toContain('peer_status');
    expect(content).toContain('## Collaboration Mode: Manual');
  });

  it('CLAUDE.md gets a minimal pointer, not full instructions', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    await runInit({ force: true, detect: true });

    const claudeMdPath = path.join(root, 'CLAUDE.md');
    expect(fs.existsSync(claudeMdPath)).toBe(true);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('## Agent Bridge');
    expect(content).toContain('.claude/skills/peer-collaborate/SKILL.md');
    // Should NOT contain full instructions
    expect(content).not.toContain('## Agent Bridge — Peer Collaboration');
    expect(content).not.toContain('peer_send');
  });

  it('cleans up legacy .cursor/rules/agent-bridge.mdc on re-init', async () => {
    const root = setupCursorProject();
    originalCwd = process.cwd();
    process.chdir(root);

    // Create legacy file
    const legacyDir = path.join(root, '.cursor', 'rules');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'agent-bridge.mdc'), 'old cursor rule', 'utf-8');

    await runInit({ force: true, detect: true });

    expect(fs.existsSync(path.join(legacyDir, 'agent-bridge.mdc'))).toBe(false);
  });
});
