import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  generateMcpConfig,
  generateRolePrompt,
  generateAgentsMd,
  writeMcpConfig,
  writeRolePrompt,
} from '../../src/init/generator.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-generator-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateMcpConfig for cursor', () => {
  it('returns valid JSON with correct structure', () => {
    const result = generateMcpConfig('cursor', '/usr/bin/agent-bridge', 'cursor-dev', '/project/.agent-bridge');
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('mcpServers');
    expect(parsed.mcpServers).toHaveProperty('agent-bridge');
    expect(parsed.mcpServers['agent-bridge'].command).toBe('/usr/bin/agent-bridge');
    expect(parsed.mcpServers['agent-bridge'].args).toContain('mcp-server');
    expect(parsed.mcpServers['agent-bridge'].args).toContain('--agent');
    expect(parsed.mcpServers['agent-bridge'].args).toContain('cursor-dev');
    expect(parsed.mcpServers['agent-bridge'].args).toContain('--bridge-dir');
    expect(parsed.mcpServers['agent-bridge'].args).toContain('/project/.agent-bridge');
  });
});

describe('generateMcpConfig for claude-code', () => {
  it('returns valid JSON', () => {
    const result = generateMcpConfig('claude-code', '/usr/bin/agent-bridge', 'claude-reviewer', '/project/.agent-bridge');
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('mcpServers');
    expect(parsed.mcpServers['agent-bridge'].command).toBe('/usr/bin/agent-bridge');
    expect(parsed.mcpServers['agent-bridge'].args).toContain('claude-reviewer');
  });
});

describe('generateMcpConfig for codex', () => {
  it('returns valid TOML format', () => {
    const result = generateMcpConfig('codex', '/usr/bin/agent-bridge', 'codex-tester', '/project/.agent-bridge');

    expect(result).toContain('[mcp_servers.agent-bridge]');
    expect(result).toContain('command = "/usr/bin/agent-bridge"');
    expect(result).toContain('args = [');
    expect(result).toContain('"mcp-server"');
    expect(result).toContain('"--agent"');
    expect(result).toContain('"codex-tester"');
    expect(result).toContain('"--bridge-dir"');
  });
});

describe('all configs use forward slashes', () => {
  it('cursor config normalizes Windows-style paths', () => {
    const result = generateMcpConfig('cursor', 'C:\\Users\\dev\\agent-bridge.exe', 'cursor-dev', 'C:\\project\\.agent-bridge');
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers['agent-bridge'].command).not.toContain('\\');
    for (const arg of parsed.mcpServers['agent-bridge'].args) {
      expect(arg).not.toContain('\\');
    }
  });

  it('codex config normalizes Windows-style paths', () => {
    const result = generateMcpConfig('codex', 'C:\\Users\\dev\\agent-bridge.exe', 'codex-tester', 'C:\\project\\.agent-bridge');

    expect(result).not.toContain('\\');
  });
});

describe('generateRolePrompt', () => {
  const agents = [
    { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' },
    { name: 'codex-tester', role: 'tester', client: 'codex' },
  ];

  it('contains agent name and role', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents);

    expect(prompt).toContain('cursor-dev');
    expect(prompt).toContain('developer');
  });

  it('contains tools list', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents);

    expect(prompt).toContain('peer_send');
    expect(prompt).toContain('peer_inbox');
    expect(prompt).toContain('peer_get_task');
    expect(prompt).toContain('peer_reply');
    expect(prompt).toContain('peer_wait');
    expect(prompt).toContain('peer_complete');
    expect(prompt).toContain('peer_cancel');
    expect(prompt).toContain('peer_status');
  });

  it('contains Workflow section', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents);

    expect(prompt).toContain('## Workflow');
  });

  it('contains Check Inbox section', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents);

    expect(prompt).toContain('## Check Inbox');
    expect(prompt).toContain('peer_inbox');
  });

  it('lists peer agents excluding self', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents);

    expect(prompt).toContain('claude-reviewer');
    expect(prompt).toContain('codex-tester');
    // Should not list self as a peer
    expect(prompt).not.toMatch(/\*\*cursor-dev\*\*/);
  });
});

describe('generateAgentsMd', () => {
  const agents = [
    { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' },
  ];

  it('contains Agent Collaboration Rules heading', () => {
    const md = generateAgentsMd(agents);
    expect(md).toContain('# Agent Collaboration Rules');
  });

  it('contains agent table', () => {
    const md = generateAgentsMd(agents);
    expect(md).toContain('| Agent | Role | Client |');
    expect(md).toContain('| cursor-dev | developer | cursor |');
    expect(md).toContain('| claude-reviewer | reviewer | claude-code |');
  });

  it('contains Communication Protocol section', () => {
    const md = generateAgentsMd(agents);
    expect(md).toContain('## Communication Protocol');
    expect(md).toContain('peer_send');
  });

  it('contains Task Types section', () => {
    const md = generateAgentsMd(agents);
    expect(md).toContain('## Task Types');
    expect(md).toContain('review');
    expect(md).toContain('debug');
    expect(md).toContain('test');
    expect(md).toContain('question');
    expect(md).toContain('implement');
  });
});

describe('writeMcpConfig for cursor', () => {
  it('creates .cursor/mcp.json', () => {
    const content = generateMcpConfig('cursor', '/bin/ab', 'cursor-dev', '/p/.agent-bridge');
    writeMcpConfig('cursor', tmpDir, content);

    const targetPath = path.join(tmpDir, '.cursor', 'mcp.json');
    expect(fs.existsSync(targetPath)).toBe(true);

    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(JSON.parse(written)).toHaveProperty('mcpServers');
  });
});

describe('writeMcpConfig for codex', () => {
  it('creates .codex/config.toml', () => {
    const content = generateMcpConfig('codex', '/bin/ab', 'codex-tester', '/p/.agent-bridge');
    writeMcpConfig('codex', tmpDir, content);

    const targetPath = path.join(tmpDir, '.codex', 'config.toml');
    expect(fs.existsSync(targetPath)).toBe(true);

    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(written).toContain('[mcp_servers.agent-bridge]');
  });
});

describe('writeMcpConfig for claude-code', () => {
  it('creates .mcp.json at project root', () => {
    const content = generateMcpConfig('claude-code', '/bin/ab', 'claude-reviewer', '/p/.agent-bridge');
    writeMcpConfig('claude-code', tmpDir, content);

    const targetPath = path.join(tmpDir, '.mcp.json');
    expect(fs.existsSync(targetPath)).toBe(true);
  });
});

describe('writeRolePrompt', () => {
  it('creates .agents/<name>.md', () => {
    const agents = [
      { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    ];
    const content = generateRolePrompt('cursor-dev', 'developer', agents);
    writeRolePrompt(tmpDir, 'cursor-dev', content);

    const targetPath = path.join(tmpDir, '.agents', 'cursor-dev.md');
    expect(fs.existsSync(targetPath)).toBe(true);

    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(written).toContain('cursor-dev');
    expect(written).toContain('developer');
  });

  it('creates .agents/ directory if it does not exist', () => {
    const agentsDir = path.join(tmpDir, '.agents');
    expect(fs.existsSync(agentsDir)).toBe(false);

    writeRolePrompt(tmpDir, 'test-agent', '# Test');

    expect(fs.existsSync(agentsDir)).toBe(true);
  });
});
