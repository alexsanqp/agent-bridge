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
  generateSkill,
  writeMcpConfig,
  writeRolePrompt,
  writeCursorRule,
  writeClaudeInstructions,
  writeSkill,
  writeClaudePointer,
  cleanupLegacyCursorRule,
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
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents, 'manual');

    expect(prompt).toContain('cursor-dev');
    expect(prompt).toContain('developer');
  });

  it('contains tools list', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents, 'manual');

    expect(prompt).toContain('peer_send');
    expect(prompt).toContain('peer_inbox');
    expect(prompt).toContain('peer_get_task');
    expect(prompt).toContain('peer_reply');
    expect(prompt).toContain('peer_wait');
    expect(prompt).toContain('peer_complete');
    expect(prompt).toContain('peer_cancel');
    expect(prompt).toContain('peer_check');
    expect(prompt).toContain('peer_status');
  });

  it('contains manual Collaboration Mode section', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents, 'manual');

    expect(prompt).toContain('## Collaboration Mode: Manual');
  });

  it('contains autonomous Collaboration Mode section', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents, 'autonomous');

    expect(prompt).toContain('## Collaboration Mode: Autonomous');
    expect(prompt).toContain('peer_inbox');
    expect(prompt).toContain('peer_check');
  });

  it('lists peer agents excluding self', () => {
    const prompt = generateRolePrompt('cursor-dev', 'developer', agents, 'manual');

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
    const md = generateAgentsMd(agents, 'manual');
    expect(md).toContain('# Agent Collaboration Rules');
  });

  it('contains agent table', () => {
    const md = generateAgentsMd(agents, 'manual');
    expect(md).toContain('| Agent | Role | Client |');
    expect(md).toContain('| cursor-dev | developer | cursor |');
    expect(md).toContain('| claude-reviewer | reviewer | claude-code |');
  });

  it('contains Communication Protocol section', () => {
    const md = generateAgentsMd(agents, 'manual');
    expect(md).toContain('## Communication Protocol');
    expect(md).toContain('peer_send');
  });

  it('contains Task Types section', () => {
    const md = generateAgentsMd(agents, 'manual');
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
    const content = generateRolePrompt('cursor-dev', 'developer', agents, 'manual');
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
    const rule = generateCursorRule('cursor-dev', 'developer', agents, 'manual');
    expect(rule).toMatch(/^---\n/);
    expect(rule).toContain('alwaysApply: true');
    expect(rule).toContain('description:');
  });

  it('includes agent name identity line', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents, 'manual');
    expect(rule).toContain('Your agent name is "cursor-dev"');
  });

  it('lists peer agents excluding self', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents, 'manual');
    expect(rule).toContain('claude-reviewer');
    expect(rule).not.toMatch(/\*\*cursor-dev\*\*/);
  });

  it('contains all MCP tools', () => {
    const rule = generateCursorRule('cursor-dev', 'developer', agents, 'manual');
    expect(rule).toContain('peer_send');
    expect(rule).toContain('peer_inbox');
    expect(rule).toContain('peer_check');
    expect(rule).toContain('peer_status');
  });
});

describe('generateClaudeInstructions', () => {
  const agents = [
    { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' },
  ];

  it('contains Agent Bridge section heading', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents, 'manual');
    expect(content).toContain('## Agent Bridge — Peer Collaboration');
  });

  it('includes agent identity', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents, 'manual');
    expect(content).toContain('"claude-reviewer"');
    expect(content).toContain('"reviewer"');
  });

  it('lists peer agents excluding self', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents, 'manual');
    expect(content).toContain('cursor-dev');
    expect(content).not.toMatch(/\*\*claude-reviewer\*\*/);
  });

  it('uses h3 headings for subsections', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents, 'manual');
    expect(content).toContain('### Available Tools');
    expect(content).toContain('### Peer Agents');
    expect(content).toContain('### Collaboration Mode: Manual');
  });

  it('generates autonomous mode instructions with h3 headings', () => {
    const content = generateClaudeInstructions('claude-reviewer', 'reviewer', agents, 'autonomous');
    expect(content).toContain('### Collaboration Mode: Autonomous');
    expect(content).toContain('#### On Session Start');
    expect(content).toContain('#### Sending Tasks');
    expect(content).toContain('#### Polling for Responses');
    expect(content).toContain('#### Responding to Incoming Tasks');
  });
});

describe('generateAgentsMd with codex agent', () => {
  it('includes codex agent identity line', () => {
    const agents = [
      { name: 'codex-tester', role: 'tester', client: 'codex' },
      { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    ];
    const md = generateAgentsMd(agents, 'manual');
    expect(md).toContain('Your agent name is `codex-tester`');
  });

  it('omits identity line when no codex agent present', () => {
    const agents = [
      { name: 'cursor-dev', role: 'developer', client: 'cursor' },
    ];
    const md = generateAgentsMd(agents, 'manual');
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

describe('generateSkill', () => {
  const agents = [
    { name: 'agent-cursor', role: 'debugger', client: 'cursor' },
    { name: 'agent-claude', role: 'architect-reviewer', client: 'claude-code' },
    { name: 'agent-codex', role: 'tester-visual', client: 'codex' },
  ];

  it('contains YAML frontmatter with name and description', () => {
    const skill = generateSkill(agents, 'manual');
    expect(skill).toMatch(/^---\n/);
    expect(skill).toContain('name: peer-collaborate');
    expect(skill).toContain('description: Peer collaboration with other AI agents via Agent Bridge.');
  });

  it('does not hardcode agent identity — uses peer_status', () => {
    const skill = generateSkill(agents, 'manual');
    expect(skill).toContain('Call `peer_status` to check your agent name and role.');
    expect(skill).not.toContain('You are agent "');
    expect(skill).not.toContain('Your agent name is "');
  });

  it('lists all peer agents', () => {
    const skill = generateSkill(agents, 'manual');
    expect(skill).toContain('agent-cursor');
    expect(skill).toContain('agent-claude');
    expect(skill).toContain('agent-codex');
  });

  it('contains all 9 MCP tools', () => {
    const skill = generateSkill(agents, 'manual');
    expect(skill).toContain('peer_send');
    expect(skill).toContain('peer_inbox');
    expect(skill).toContain('peer_get_task');
    expect(skill).toContain('peer_reply');
    expect(skill).toContain('peer_wait');
    expect(skill).toContain('peer_complete');
    expect(skill).toContain('peer_cancel');
    expect(skill).toContain('peer_check');
    expect(skill).toContain('peer_status');
  });

  it('generates manual mode instructions', () => {
    const skill = generateSkill(agents, 'manual');
    expect(skill).toContain('## Collaboration Mode: Manual');
  });

  it('generates autonomous mode instructions', () => {
    const skill = generateSkill(agents, 'autonomous');
    expect(skill).toContain('## Collaboration Mode: Autonomous');
    expect(skill).toContain('peer_check');
    expect(skill).toContain('Do NOT use `peer_wait`');
  });

  it('does not contain MDC frontmatter (alwaysApply)', () => {
    const skill = generateSkill(agents, 'manual');
    expect(skill).not.toContain('alwaysApply');
  });
});

describe('writeSkill', () => {
  it('writes to both .agents/skills/ and .claude/skills/ directories', () => {
    writeSkill(tmpDir, '# Test Skill');

    const agentsSkillPath = path.join(tmpDir, '.agents', 'skills', 'peer-collaborate', 'SKILL.md');
    const claudeSkillPath = path.join(tmpDir, '.claude', 'skills', 'peer-collaborate', 'SKILL.md');

    expect(fs.existsSync(agentsSkillPath)).toBe(true);
    expect(fs.existsSync(claudeSkillPath)).toBe(true);

    expect(fs.readFileSync(agentsSkillPath, 'utf-8')).toBe('# Test Skill');
    expect(fs.readFileSync(claudeSkillPath, 'utf-8')).toBe('# Test Skill');
  });

  it('creates nested directories if they do not exist', () => {
    const agentsSkillDir = path.join(tmpDir, '.agents', 'skills', 'peer-collaborate');
    const claudeSkillDir = path.join(tmpDir, '.claude', 'skills', 'peer-collaborate');

    expect(fs.existsSync(agentsSkillDir)).toBe(false);
    expect(fs.existsSync(claudeSkillDir)).toBe(false);

    writeSkill(tmpDir, '# Test');

    expect(fs.existsSync(agentsSkillDir)).toBe(true);
    expect(fs.existsSync(claudeSkillDir)).toBe(true);
  });

  it('both files have identical content', () => {
    const content = '---\nname: peer-collaborate\n---\n# Skill Content';
    writeSkill(tmpDir, content);

    const agentsContent = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'peer-collaborate', 'SKILL.md'), 'utf-8');
    const claudeContent = fs.readFileSync(
      path.join(tmpDir, '.claude', 'skills', 'peer-collaborate', 'SKILL.md'), 'utf-8');

    expect(agentsContent).toBe(claudeContent);
  });
});

describe('writeClaudePointer', () => {
  it('creates CLAUDE.md with pointer if it does not exist', () => {
    writeClaudePointer(tmpDir);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    expect(fs.existsSync(claudeMdPath)).toBe(true);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('## Agent Bridge');
    expect(content).toContain('.claude/skills/peer-collaborate/SKILL.md');
    expect(content).toContain('peer_status');
  });

  it('appends pointer to existing CLAUDE.md', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '# My Project\n\nSome content.\n', 'utf-8');

    writeClaudePointer(tmpDir);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some content.');
    expect(content).toContain('## Agent Bridge');
    expect(content).toContain('.claude/skills/peer-collaborate/SKILL.md');
  });

  it('replaces old full Agent Bridge section with pointer', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '# My Project\n\n## Agent Bridge — Peer Collaboration\n\nOld full instructions here\n\n### Tools\n\nBig list\n', 'utf-8');

    writeClaudePointer(tmpDir);

    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).not.toContain('Old full instructions');
    expect(content).toContain('## Agent Bridge');
    expect(content).toContain('.claude/skills/peer-collaborate/SKILL.md');
  });

  it('is idempotent — re-running replaces existing pointer', () => {
    writeClaudePointer(tmpDir);
    writeClaudePointer(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const matches = content.match(/## Agent Bridge/g);
    expect(matches).toHaveLength(1);
  });
});

describe('cleanupLegacyCursorRule', () => {
  it('removes .cursor/rules/agent-bridge.mdc if it exists', () => {
    const rulesDir = path.join(tmpDir, '.cursor', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'agent-bridge.mdc'), 'old rule', 'utf-8');

    const removed = cleanupLegacyCursorRule(tmpDir);

    expect(removed).toBe(true);
    expect(fs.existsSync(path.join(rulesDir, 'agent-bridge.mdc'))).toBe(false);
  });

  it('returns false if legacy file does not exist', () => {
    const removed = cleanupLegacyCursorRule(tmpDir);
    expect(removed).toBe(false);
  });
});

describe('autonomy mode in generators', () => {
  const agents = [
    { name: 'agent-a', role: 'developer', client: 'cursor' },
    { name: 'agent-b', role: 'reviewer', client: 'claude-code' },
  ];

  describe('manual mode', () => {
    it('generateRolePrompt includes Manual mode header', () => {
      const result = generateRolePrompt('agent-a', 'developer', agents, 'manual');
      expect(result).toContain('Manual');
      expect(result).toContain('peer_wait');
    });

    it('generateCursorRule includes Manual instructions', () => {
      const result = generateCursorRule('agent-a', 'developer', agents, 'manual');
      expect(result).toContain('Manual');
      expect(result).toContain('user asks');
    });

    it('generateClaudeInstructions includes Manual mode', () => {
      const result = generateClaudeInstructions('agent-b', 'reviewer', agents, 'manual');
      expect(result).toContain('Manual');
    });

    it('generateAgentsMd includes manual workflow section', () => {
      const result = generateAgentsMd(agents, 'manual');
      expect(result).toContain('Collaboration Mode: Manual');
    });
  });

  describe('autonomous mode', () => {
    it('generateRolePrompt includes Autonomous mode header', () => {
      const result = generateRolePrompt('agent-a', 'developer', agents, 'autonomous');
      expect(result).toContain('Autonomous');
      expect(result).toContain('peer_check');
      expect(result).toContain('Do NOT use `peer_wait`');
    });

    it('generateCursorRule includes autonomous polling instructions', () => {
      const result = generateCursorRule('agent-a', 'developer', agents, 'autonomous');
      expect(result).toContain('Autonomous');
      expect(result).toContain('peer_inbox');
      expect(result).toContain('On Session Start');
      expect(result).toContain('peer_check');
    });

    it('generateClaudeInstructions warns against peer_wait', () => {
      const result = generateClaudeInstructions('agent-b', 'reviewer', agents, 'autonomous');
      expect(result).toContain('Do NOT use `peer_wait`');
      expect(result).toContain('peer_check');
    });

    it('generateAgentsMd mentions proactive behavior', () => {
      const result = generateAgentsMd(agents, 'autonomous');
      expect(result).toContain('proactively');
    });
  });
});
