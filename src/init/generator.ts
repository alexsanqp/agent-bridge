import fs from 'node:fs';
import path from 'node:path';
import { toForwardSlashes } from '../utils/paths.js';

interface AgentInfo {
  name: string;
  role: string;
  client: string;
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
- \`peer_status\` — Check bridge status

## Peer Agents

${peerList}

## Workflow

1. When you need help from a peer, use \`peer_send\` to send them a task
2. Use \`peer_wait\` to block until the response is back
3. Read the response with \`peer_get_task\`
4. Apply the results to your work
5. Mark the task complete with \`peer_complete\`

## Check Inbox

Periodically check \`peer_inbox\` for tasks assigned to you.
When you receive a task, read it with \`peer_get_task\`, do the work,
and reply with \`peer_reply\`.
`;
}

export function generateCursorRule(
  agentName: string,
  role: string,
  allAgents: AgentInfo[],
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
- \`peer_status\` — Check bridge status

## Peer Agents

${peerList}

## Workflow

1. When you need help from a peer, use \`peer_send\` to send them a task
2. Use \`peer_wait\` to block until the response is back
3. Read the response with \`peer_get_task\`
4. Apply the results to your work
5. Mark the task complete with \`peer_complete\`

## Check Inbox

Periodically check \`peer_inbox\` for tasks assigned to you.
When you receive a task, read it with \`peer_get_task\`, do the work,
and reply with \`peer_reply\`.
`;
}

export function generateClaudeInstructions(
  agentName: string,
  role: string,
  allAgents: AgentInfo[],
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
- \`peer_status\` — Check bridge status

### Peer Agents

${peerList}

### Workflow

1. When you need help from a peer, use \`peer_send\` to send them a task
2. Use \`peer_wait\` to block until the response is back
3. Read the response with \`peer_get_task\`
4. Apply the results to your work
5. Mark the task complete with \`peer_complete\`

### Check Inbox

Periodically check \`peer_inbox\` for tasks assigned to you.
When you receive a task, read it with \`peer_get_task\`, do the work,
and reply with \`peer_reply\`.
`;
}

export function generateAgentsMd(agents: AgentInfo[]): string {
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

export function writeCursorRule(projectRoot: string, content: string): void {
  const rulesDir = path.join(projectRoot, '.cursor', 'rules');
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }
  fs.writeFileSync(path.join(rulesDir, 'agent-bridge.mdc'), content, 'utf-8');
}

const CLAUDE_MD_SECTION_MARKER = '## Agent Bridge — Peer Collaboration';

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
