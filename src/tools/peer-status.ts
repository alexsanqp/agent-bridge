import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { BridgeError } from '../domain/errors.js';
import { updateLastSeen, getAgent, getAgents } from '../store/agents.js';
import { getActiveTasks, getTasksByReceiver } from '../store/tasks.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  _bridgeDir: string,
): void {
  server.tool(
    'peer_status',
    'Get bridge status and agent info including active tasks, pending inbox, and known agents',
    async () => {
      try {
        updateLastSeen(db, agentName);

        const activeTasks = getActiveTasks(db);
        const pendingInbox = getTasksByReceiver(db, agentName, TaskStatus.Pending);
        const agents = getAgents(db);
        const self = getAgent(db, agentName);

        let bridgeOk = true;
        try {
          db.prepare('SELECT 1').get();
        } catch {
          bridgeOk = false;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                agent: agentName,
                role: self?.role ?? 'agent',
                bridge_ok: bridgeOk,
                active_tasks: activeTasks.length,
                pending_inbox: pendingInbox.length,
                known_agents: agents.map((a) => ({
                  name: a.name,
                  role: a.role,
                  client: a.client,
                  last_seen: a.last_seen,
                })),
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof BridgeError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: err.code, message: err.message }),
              },
            ],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
