import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type BetterSqlite3 from 'better-sqlite3';
import { openDatabase, closeDatabase } from './store/database.js';
import { upsertAgent, updateLastSeen } from './store/agents.js';
import { ensureCoordinatorRunning } from './commands/coordinator.js';
import { findProjectRoot } from './utils/paths.js';
import { register as registerPeerSend } from './tools/peer-send.js';
import { register as registerPeerReply } from './tools/peer-reply.js';
import { register as registerPeerInbox } from './tools/peer-inbox.js';
import { register as registerPeerGetTask } from './tools/peer-get-task.js';
import { register as registerPeerWait } from './tools/peer-wait.js';
import { register as registerPeerComplete } from './tools/peer-complete.js';
import { register as registerPeerCancel } from './tools/peer-cancel.js';
import { register as registerPeerStatus } from './tools/peer-status.js';
import { register as registerPeerCheck } from './tools/peer-check.js';
import { loadConfig } from './config/loader.js';

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

export async function startMcpServer(agentName: string, bridgeDir: string): Promise<void> {
  const db = openDatabase(bridgeDir);

  const config = loadConfig(bridgeDir);
  const agentConfig = config.agents.find(a => a.name === agentName);
  const role = agentConfig?.role ?? 'agent';
  const client = agentConfig?.client ?? 'unknown';
  upsertAgent(db, { name: agentName, role, client });

  const server = new McpServer({ name: 'agent-bridge', version: '0.1.0' });

  registerPeerSend(server, db, agentName, bridgeDir);
  registerPeerReply(server, db, agentName, bridgeDir);
  registerPeerInbox(server, db, agentName, bridgeDir);
  registerPeerGetTask(server, db, agentName, bridgeDir);
  registerPeerWait(server, db, agentName, bridgeDir);
  registerPeerComplete(server, db, agentName, bridgeDir);
  registerPeerCancel(server, db, agentName, bridgeDir);
  registerPeerStatus(server, db, agentName, bridgeDir);
  registerPeerCheck(server, db, agentName, bridgeDir);

  // Auto-start coordinator if enabled in config
  if (config.coordinator?.enabled) {
    try {
      const projectRoot = bridgeDir.replace(/[\\/]\.agent-bridge$/, '');
      ensureCoordinatorRunning(bridgeDir, projectRoot);
    } catch { /* ignore — coordinator is optional */ }
  }

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

