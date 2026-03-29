import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  generateMcpConfig,
  generateRolePrompt,
  generateAgentsMd,
  generateCursorRule,
  generateClaudeInstructions,
  writeMcpConfig,
  writeRolePrompt,
  writeCursorRule,
  writeClaudeInstructions,
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

describe('generateCursorRule', () => {
  const agents = [
    { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' },
  ];

  it('contains MDC frontmatter with alwaysApply', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents);
    expect(rule).toMatch(/^---\n/);
    expect(rule).toContain('alwaysApply: true');
    expect(rule).toContain('description:');
  });

  it('includes agent name identity line', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents);
    expect(rule).toContain('Your agent name is "cursor-dev"');
  });

  it('lists peer agents excluding self', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents);
    expect(rule).toContain('claude-reviewer');
    expect(rule).not.toMatch(/\*\*cursor-dev\*\*/);
  });

  it('contains all MCP tools', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents);
    expect(rule).toContain('peer_send');
    expect(rule).toContain('peer_inbox');
    expect(rule).toContain('peer_status');
  });
});

describe('generateClaudeInstructions', () => {
  const agents = [
    { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' },
  ];

  it('contains Agent Bridge section heading', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents);
    expect(content).toContain('## Agent Bridge — Peer Collaboration');
  });

  it('includes agent identity', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents);
    expect(content).toContain('"claude-reviewer"');
    expect(content).toContain('"reviewer"');
  });

  it('lists peer agents excluding self', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents);
    expect(content).toContain('cursor-dev');
    expect(content).not.toMatch(/\*\*claude-reviewer\*\*/);
  });

  it('uses h3 headings for subsections', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents);
    expect(content).toContain('### Available Tools');
    expect(content).toContain('### Peer Agents');
    expect(content).toContain('### Workflow');
    expect(content).toContain('### Check Inbox');
  });
});

describe('generateAgentsMd with codex agent', () => {
  it('includes codex agent identity line', () => {
    const agents = [
      { name: 'codex-tester', role: 'tester', client: 'codex' },
      { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    ];
    const md = generateAgentsMd(agents);
    expect(md).toContain('Your agent name is `codex-tester`');
  });

  it('omits identity line when no codex agent present', () => {
    const agents = [
      { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    ];
    const md = generateAgentsMd(agents);
    expect(md).not.toContain('Your agent name is');
  });
});

describe('writeCursorRule', () => {
  it('creates .cursor/rules/agent-bridge.mdc', () => {
    writeCursorRule(tmpDir, '---\nalwaysApply: true\n---\n# Test');

    const targetPath = path.join(tmpDir, '.cursor', 'rules', 'agent-bridge.mdc');
    expect(fs.existsSync(targetPath)).toBe(true);

    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(written).toContain('alwaysApply: true');
  });

  it('creates nested directories if they do not exist', () => {
    const rulesDir = path.join(tmpDir, '.cursor', 'rules');
    expect(fs.existsSync(rulesDir)).toBe(false);

    writeCursorRule(tmpDir, '# Test');

    expect(fs.existsSync(rulesDir)).toBe(true);
  });
});

describe('writeClaudeInstructions', () => {
  it('creates CLAUDE.md if it does not exist', () => {
    const content = '\n## Agent Bridge — Peer Collaboration\n\nTest content\n';
    writeClaudeInstructions(tmpDir, content);

    const targetPath = path.join(tmpDir, 'CLAUDE.md');
    expect(fs.existsSync(targetPath)).toBe(true);

    const written = fs.readFileSync(targetPath, 'utf-8');
    expect(written).toContain('## Agent Bridge — Peer Collaboration');
  });

  it('appends to existing CLAUDE.md without Agent Bridge section', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '# My Project\n\nExisting content.\n', 'utf-8');

    const content = '\n## Agent Bridge — Peer Collaboration\n\nNew section\n';
    writeClaudeInstructions(tmpDir, content);

    const written = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(written).toContain('# My Project');
    expect(written).toContain('Existing content.');
    expect(written).toContain('## Agent Bridge — Peer Collaboration');
  });

  it('replaces existing Agent Bridge section on re-init', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '# My Project\n\n## Agent Bridge — Peer Collaboration\n\nOld content\n', 'utf-8');

    const content = '\n## Agent Bridge — Peer Collaboration\n\nUpdated content\n';
    writeClaudeInstructions(tmpDir, content);

    const written = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(written).toContain('# My Project');
    expect(written).toContain('Updated content');
    expect(written).not.toContain('Old content');
  });

  it('preserves content after Agent Bridge section when followed by another h2', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '# My Project\n\n## Agent Bridge — Peer Collaboration\n\nOld stuff\n\n## Other Section\n\nKeep this.\n', 'utf-8');

    const content = '\n## Agent Bridge — Peer Collaboration\n\nReplaced\n';
    writeClaudeInstructions(tmpDir, content);

    const written = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(written).toContain('Replaced');
    expect(written).not.toContain('Old stuff');
    expect(written).toContain('## Other Section');
    expect(written).toContain('Keep this.');
  });
});
