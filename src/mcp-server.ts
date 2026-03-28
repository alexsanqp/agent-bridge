import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type BetterSqlite3 from 'better-sqlite3';
import { openDatabase, closeDatabase } from './store/database.js';
import { upsertAgent, updateLastSeen } from './store/agents.js';
import { register as registerPeerSend } from './tools/peer-send.js';
import { register as registerPeerReply } from './tools/peer-reply.js';
import { register as registerPeerInbox } from './tools/peer-inbox.js';
import { register as registerPeerGetTask } from './tools/peer-get-task.js';
import { register as registerPeerWait } from './tools/peer-wait.js';
import { register as registerPeerComplete } from './tools/peer-complete.js';
import { register as registerPeerCancel } from './tools/peer-cancel.js';
import { register as registerPeerStatus } from './tools/peer-status.js';

export type ToolCallback<T> = (args: T) => Promise<{ content: Array<{ type: string; text: string }> }>;

/**
 * Wraps a tool callback to update the agent's last_seen timestamp
 * before executing the actual handler.
 */
export function withLastSeen<T>(
  db: BetterSqlite3.Database,
  agentName: string,
  handler: ToolCallback<T>,
): ToolCallback<T> {
  return async (args: T) => {
    updateLastSeen(db, agentName);
    return handler(args);
  };
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

export async function startMcpServer(agentName: string, bridgeDir: string): Promise<void> {
  const db = openDatabase(bridgeDir);

  upsertAgent(db, { name: agentName, role: 'agent', client: 'unknown' });

  const server = new McpServer({ name: 'agent-bridge', version: '0.1.0' });

  registerPeerSend(server, db, agentName, bridgeDir);
  registerPeerReply(server, db, agentName, bridgeDir);
  registerPeerInbox(server, db, agentName, bridgeDir);
  registerPeerGetTask(server, db, agentName, bridgeDir);
  registerPeerWait(server, db, agentName, bridgeDir);
  registerPeerComplete(server, db, agentName, bridgeDir);
  registerPeerCancel(server, db, agentName, bridgeDir);
  registerPeerStatus(server, db, agentName, bridgeDir);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    closeDatabase(db);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}

const agentName = getArg('--agent');
const bridgeDir = getArg('--bridge-dir');

if (!agentName || !bridgeDir) {
  console.error('Usage: agent-bridge mcp-server --agent <name> --bridge-dir <path>');
  process.exit(1);
}

startMcpServer(agentName, bridgeDir).catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
