import fs from 'node:fs';
import path from 'node:path';
import { toForwardSlashes } from '../utils/paths.js';

interface AgentInfo {
  name: string;
  role: string;
  client: string;
}

function generateWorkflowSection(mode: 'manual' | 'autonomous', heading: '##' | '###' = '##'): string {
  if (mode === 'autonomous') {
    return `${heading} Collaboration Mode: Autonomous

You operate proactively in peer collaboration.

${heading}# On Session Start
ALWAYS call \`peer_inbox\` first. If there are tasks assigned to you,
process them before doing anything else.

${heading}# Sending Tasks
1. Use \`peer_send\` to create the task
2. Do NOT use \`peer_wait\` — it will timeout on most clients
3. Continue with other work
4. Use \`peer_check(task_id)\` to poll for responses
5. When \`new_message_count > 0\`, read full details with \`peer_get_task\`

${heading}# Polling for Responses
When waiting for a response:
1. Call \`peer_check(task_id)\` to check if a reply arrived
2. If \`new_message_count\` is 0 — continue other work or tell the user you are waiting
3. If \`new_message_count\` > 0 — call \`peer_get_task\` to read the full reply

${heading}# Responding to Incoming Tasks
When \`peer_inbox\` shows tasks assigned to you:
1. Read with \`peer_get_task\`
2. Do the requested work
3. Reply with \`peer_reply\` including your results
4. Mark complete with \`peer_complete\` if appropriate`;
  }

  return `${heading} Collaboration Mode: Manual

Use peer collaboration tools when the user asks you to.
- Send tasks when the user says "send to X" or "ask X to review"
- Check inbox when the user says "check inbox" or "check for messages"
- Use \`peer_wait\` to block until a reply arrives when the user wants to wait`;
}

export function generateMcpConfig(
  client: string,
  binaryPath: string,
  agentName: string,
  bridgeDir: string,
): string {
  const safeBinary = toForwardSlashes(binaryPath);
  const safeBridgeDir = toForwardSlashes(bridgeDir);
  const args = ['mcp-server', '--agent', agentName, '--bridge-dir', safeBridgeDir];

  if (client === 'codex') {
    const argsToml = args.map((a) => `"${a}"`).join(', ');
    return [
      '[mcp_servers.agent-bridge]',
      `command = "${safeBinary}"`,
      `args = [${argsToml}]`,
      '',
    ].join('\n');
  }

  // cursor and claude-code both use JSON format
  const config = {
    mcpServers: {
      'agent-bridge': {
        command: safeBinary,
        args,
      },
    },
  };
  return JSON.stringify(config, null, 2) + '\n';
}

export function generateRolePrompt(
  agentName: string,
  role: string,
  allAgents: AgentInfo[],
  mode: 'manual' | 'autonomous',
): string {
  const peers = allAgents.filter((a) => a.name !== agentName);
  const peerList =
    peers.length > 0
      ? peers.map((p) => `- **${p.name}** — ${p.role} (${p.client})`).join('\n')
      : '- No other agents configured';

  return `# Role: ${role.charAt(0).toUpperCase() + role.slice(1)} (${agentName})

You are a ${role} agent working in a peer collaboration environment.

## Peer Collaboration Tools

You have access to these MCP tools for collaborating with other agents:

- \`peer_send\` — Send a task to another agent
- \`peer_inbox\` — Check for tasks assigned to you
- \`peer_get_task\` — Read full task details
- \`peer_reply\` — Reply to a task
- \`peer_wait\` — Wait for a reply (blocks until response)
- \`peer_complete\` — Mark a task done
- \`peer_cancel\` — Cancel a task
- \`peer_check\` — Quick poll for new activity on a task (lightweight)
- \`peer_status\` — Check bridge status

## Peer Agents

${peerList}

${generateWorkflowSection(mode)}
`;
}

export function generateSkill(
  allAgents: AgentInfo[],
  mode: 'manual' | 'autonomous',
): string {
  const peerList =
    allAgents.length > 0
      ? allAgents.map((p) => `- **${p.name}** — ${p.role} (${p.client})`).join('\n')
      : '- No agents configured yet';

  return `---
name: peer-collaborate
description: Peer collaboration with other AI agents via Agent Bridge. Use when collaborating, sending tasks, checking inbox, or reviewing code with peer agents.
---

# Agent Bridge — Peer Collaboration

You are an AI agent in a peer collaboration environment.
Call \`peer_status\` to check your agent name and role.

## Activation

**First thing to do:** Call \`peer_status\` to activate yourself and see who else is online.
Agents are considered active if seen within the last 5 minutes.

**Cursor users:** Make sure the \`peer-collaborate\` skill is enabled in Cursor settings.

## Peer Agents

${peerList}

## Available Tools

You have access to these MCP tools for collaborating with other agents:

- \`peer_send\` — Send a task to another agent
- \`peer_inbox\` — Check for tasks assigned to you
- \`peer_get_task\` — Read full task details
- \`peer_reply\` — Reply to a task
- \`peer_wait\` — Wait for a reply (blocks until response)
- \`peer_complete\` — Mark a task done
- \`peer_cancel\` — Cancel a task
- \`peer_check\` — Quick poll for new activity on a task (lightweight)
- \`peer_status\` — Check bridge status

${generateWorkflowSection(mode)}
`;
}

export function writeSkill(projectRoot: string, content: string): void {
  const targets = [
    path.join(projectRoot, '.agents', 'skills', 'peer-collaborate', 'SKILL.md'),
    path.join(projectRoot, '.claude', 'skills', 'peer-collaborate', 'SKILL.md'),
  ];

  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(target, content, 'utf-8');
  }
}

/** @deprecated Use generateSkill() instead. Kept for backward compatibility. */
export function generateCursorRule(
  agentName: string,
  role: string,
  allAgents: AgentInfo[],
  mode: 'manual' | 'autonomous',
): string {
  const peers = allAgents.filter((a) => a.name !== agentName);
  const peerList =
    peers.length > 0
      ? peers.map((p) => `- **${p.name}** — ${p.role} (${p.client})`).join('\n')
      : '- No other agents configured';

  return `---
description: Agent Bridge peer collaboration instructions for this Cursor agent
alwaysApply: true
---

# Role: ${role.charAt(0).toUpperCase() + role.slice(1)} (${agentName})

You are a ${role} agent working in a peer collaboration environment.
Your agent name is "${agentName}" — use this when other agents send you tasks.

## Peer Collaboration Tools

You have access to these MCP tools for collaborating with other agents:

- \`peer_send\` — Send a task to another agent
- \`peer_inbox\` — Check for tasks assigned to you
- \`peer_get_task\` — Read full task details
- \`peer_reply\` — Reply to a task
- \`peer_wait\` — Wait for a reply (blocks until response)
- \`peer_complete\` — Mark a task done
- \`peer_cancel\` — Cancel a task
- \`peer_check\` — Quick poll for new activity on a task (lightweight)
- \`peer_status\` — Check bridge status

## Peer Agents

${peerList}

${generateWorkflowSection(mode)}
`;
}

/** @deprecated Use generateSkill() instead. Kept for backward compatibility. */
export function generateClaudeInstructions(
  agentName: string,
  role: string,
  allAgents: AgentInfo[],
  mode: 'manual' | 'autonomous',
): string {
  const peers = allAgents.filter((a) => a.name !== agentName);
  const peerList =
    peers.length > 0
      ? peers.map((p) => `- **${p.name}** — ${p.role} (${p.client})`).join('\n')
      : '- No other agents configured';

  return `
## Agent Bridge — Peer Collaboration

You are agent "${agentName}" with role "${role}" in a peer collaboration environment.

### Available Tools

- \`peer_send\` — Send a task to another agent
- \`peer_inbox\` — Check for tasks assigned to you
- \`peer_get_task\` — Read full task details
- \`peer_reply\` — Reply to a task
- \`peer_wait\` — Wait for a reply (blocks until response)
- \`peer_complete\` — Mark a task done
- \`peer_cancel\` — Cancel a task
- \`peer_check\` — Quick poll for new activity on a task (lightweight)
- \`peer_status\` — Check bridge status

### Peer Agents

${peerList}

${generateWorkflowSection(mode, '###')}
`;
}

export function generateAgentsMd(agents: AgentInfo[], mode: 'manual' | 'autonomous'): string {
  const rows = agents
    .map((a) => `| ${a.name} | ${a.role} | ${a.client} |`)
    .join('\n');

  // Find codex agent to personalize instructions
  const codexAgent = agents.find((a) => a.client === 'codex');
  const codexIdentity = codexAgent
    ? `\nYour agent name is \`${codexAgent.name}\` — this is how other agents address you.\n`
    : '';

  return `# Agent Collaboration Rules
${codexIdentity}
## Agents in this project

| Agent | Role | Client |
|-------|------|--------|
${rows}

## Communication Protocol

1. Use \`peer_send\` to create tasks, not free-form messages
2. Always include a clear \`summary\` — it's what appears in inbox
3. Attach relevant files as artifacts, don't paste large code blocks in body
4. Check \`peer_inbox\` at the start of your session and between tasks
5. Reply to every task assigned to you, even if it's "can't help with this"
6. Mark tasks \`complete\` when done, don't leave them hanging

## Task Types

- \`review\` — code review request
- \`debug\` — help debugging an issue
- \`test\` — write or run tests
- \`question\` — ask for information or opinion
- \`implement\` — request to implement something

${generateWorkflowSection(mode)}
`;
}

export function writeMcpConfig(
  client: string,
  projectRoot: string,
  content: string,
): void {
  let targetPath: string;

  switch (client) {
    case 'cursor':
      targetPath = path.join(projectRoot, '.cursor', 'mcp.json');
      break;
    case 'claude-code':
      targetPath = path.join(projectRoot, '.mcp.json');
      break;
    case 'codex':
      targetPath = path.join(projectRoot, '.codex', 'config.toml');
      break;
    default:
      throw new Error(`Unknown client: ${client}`);
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, content, 'utf-8');
}

export function writeRolePrompt(
  projectRoot: string,
  agentName: string,
  content: string,
): void {
  const agentsDir = path.join(projectRoot, '.agents');
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(agentsDir, `${agentName}.md`), content, 'utf-8');
}

/** @deprecated Use writeSkill() instead. Kept for backward compatibility. */
export function writeCursorRule(projectRoot: string, content: string): void {
  const rulesDir = path.join(projectRoot, '.cursor', 'rules');
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(rulesDir, 'agent-bridge.mdc'), content, 'utf-8');
}

const CLAUDE_MD_SECTION_MARKER = '## Agent Bridge — Peer Collaboration';
const CLAUDE_MD_POINTER_MARKER = '## Agent Bridge';

export function writeClaudePointer(projectRoot: string): void {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  const pointer = `
## Agent Bridge

This project uses Agent Bridge for peer collaboration between AI agents.
See \`.claude/skills/peer-collaborate/SKILL.md\` for instructions.
Call \`peer_status\` to check your agent name and role.
`;

  let existing = '';
  if (fs.existsSync(claudeMdPath)) {
    existing = fs.readFileSync(claudeMdPath, 'utf-8');

    // Replace old full Agent Bridge section if present
    if (existing.includes(CLAUDE_MD_SECTION_MARKER)) {
      const markerIndex = existing.indexOf(CLAUDE_MD_SECTION_MARKER);
      const afterMarker = existing.substring(markerIndex + CLAUDE_MD_SECTION_MARKER.length);
      const nextH2Match = afterMarker.match(/\n## (?!#)/);
      if (nextH2Match && nextH2Match.index !== undefined) {
        const before = existing.substring(0, markerIndex).trimEnd();
        const after = existing.substring(markerIndex + CLAUDE_MD_SECTION_MARKER.length + nextH2Match.index);
        fs.writeFileSync(claudeMdPath, before + '\n' + pointer + after, 'utf-8');
      } else {
        const before = existing.substring(0, markerIndex).trimEnd();
        fs.writeFileSync(claudeMdPath, before + '\n' + pointer, 'utf-8');
      }
      return;
    }

    // Replace existing pointer section if present
    if (existing.includes(CLAUDE_MD_POINTER_MARKER)) {
      const markerIndex = existing.indexOf(CLAUDE_MD_POINTER_MARKER);
      const afterMarker = existing.substring(markerIndex + CLAUDE_MD_POINTER_MARKER.length);
      const nextH2Match = afterMarker.match(/\n## (?!#)/);
      if (nextH2Match && nextH2Match.index !== undefined) {
        const before = existing.substring(0, markerIndex).trimEnd();
        const after = existing.substring(markerIndex + CLAUDE_MD_POINTER_MARKER.length + nextH2Match.index);
        fs.writeFileSync(claudeMdPath, before + '\n' + pointer + after, 'utf-8');
      } else {
        const before = existing.substring(0, markerIndex).trimEnd();
        fs.writeFileSync(claudeMdPath, before + '\n' + pointer, 'utf-8');
      }
      return;
    }
  }

  // Append to existing or create new
  const prefix = existing.length > 0 ? existing.trimEnd() + '\n' : '';
  fs.writeFileSync(claudeMdPath, prefix + pointer, 'utf-8');
}

export function cleanupLegacyCursorRule(projectRoot: string): boolean {
  const legacyPath = path.join(projectRoot, '.cursor', 'rules', 'agent-bridge.mdc');
  if (fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
    return true;
  }
  return false;
}

/** @deprecated Use writeClaudePointer() instead. Kept for backward compatibility. */
export function writeClaudeInstructions(
  projectRoot: string,
  content: string,
): void {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  let existing = '';

  if (fs.existsSync(claudeMdPath)) {
    existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (existing.includes(CLAUDE_MD_SECTION_MARKER)) {
      // Replace existing Agent Bridge section (everything from marker to end or next top-level heading)
      const markerIndex = existing.indexOf(CLAUDE_MD_SECTION_MARKER);
      // Find next "## " heading that is NOT part of Agent Bridge subsections (### level)
      const afterMarker = existing.substring(markerIndex + CLAUDE_MD_SECTION_MARKER.length);
      const nextH2Match = afterMarker.match(/\n## (?!#)/);
      if (nextH2Match && nextH2Match.index !== undefined) {
        const before = existing.substring(0, markerIndex).trimEnd();
        const after = existing.substring(markerIndex + CLAUDE_MD_SECTION_MARKER.length + nextH2Match.index);
        fs.writeFileSync(claudeMdPath, before + '\n' + content + after, 'utf-8');
      } else {
        // Agent Bridge section goes to end of file — replace it entirely
        const before = existing.substring(0, markerIndex).trimEnd();
        fs.writeFileSync(claudeMdPath, before + '\n' + content, 'utf-8');
      }
      return;
    }
  }

  // Append to existing or create new
  const prefix = existing.length > 0 ? existing.trimEnd() + '\n' : '';
  fs.writeFileSync(claudeMdPath, prefix + content, 'utf-8');
}
