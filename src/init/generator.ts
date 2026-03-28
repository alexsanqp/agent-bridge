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
      ? peers.map((p) => `- **${p.name}** (${p.role}, ${p.client})`).join('\n')
      : '- No other agents configured';

  return `# Agent: ${agentName}
## Role: ${role}

You are **${agentName}**, operating in the **${role}** role within a multi-agent collaboration environment.

## MCP Tools Available

Use these tools (provided via the \`agent-bridge\` MCP server) to collaborate with peer agents:

| Tool | Purpose |
|------|---------|
| \`peer_send\` | Send a task or question to another agent |
| \`peer_reply\` | Reply to a task assigned to you |
| \`peer_inbox\` | Check your inbox for pending tasks |
| \`peer_get_task\` | Get full details of a specific task |
| \`peer_wait\` | Wait for a reply to a task you sent |
| \`peer_complete\` | Mark a task as completed |
| \`peer_cancel\` | Cancel a task you created |
| \`peer_status\` | Check the status of all agents and tasks |

## Workflow Guidance

1. **Check your inbox** at the start of each session with \`peer_inbox\`.
2. **Process tasks** by reading the full task with \`peer_get_task\`, then working on it.
3. **Reply** with your results using \`peer_reply\`.
4. **Delegate** by sending tasks to peers using \`peer_send\` when appropriate.
5. **Wait** for responses with \`peer_wait\` when you need input from others.

## Peer Agents

${peerList}

## Communication Rules

- Be concise and structured in all messages.
- Include relevant file paths and code snippets in replies.
- Use task types appropriately: \`review\`, \`debug\`, \`test\`, \`question\`, \`implement\`.
- Complete or cancel tasks you own — do not leave them hanging.
`;
}

export function generateAgentsMd(agents: AgentInfo[]): string {
  const rows = agents
    .map((a) => `| ${a.name} | ${a.role} | ${a.client} |`)
    .join('\n');

  return `# Agents

This project uses **Agent Bridge** for multi-agent collaboration.

## Registered Agents

| Name | Role | Client |
|------|------|--------|
${rows}

## Communication Rules

1. Agents communicate exclusively through the Agent Bridge MCP tools.
2. Never modify another agent's files directly — send a task instead.
3. Each task must have a clear summary and expected deliverable.
4. Reply to tasks promptly with structured results.
5. Use \`peer_status\` to check system health before complex workflows.

## Quick Start

- Run \`agent-bridge mcp-server --agent <name>\` to start the MCP server for an agent.
- Each agent should call \`peer_inbox\` at session start to check for pending work.
- See \`.agents/<agent-name>.md\` for role-specific instructions.
`;
}

export function generateConfigYaml(
  agents: AgentInfo[],
  expMinutes?: number,
): string {
  const agentEntries = agents
    .map(
      (a) =>
        `  - name: "${a.name}"\n    role: "${a.role}"\n    client: "${a.client}"`,
    )
    .join('\n');

  return `version: 1

agents:
${agentEntries}

policies:
  blocked_patterns:
    - "**/.env"
    - "**/*.key"
    - "**/*.pem"
  max_artifact_size_kb: 512

expiration_minutes: ${expMinutes ?? 30}
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
