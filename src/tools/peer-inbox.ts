import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { isTerminal } from '../domain/status.js';
import { BridgeError } from '../domain/errors.js';
import { updateLastSeen } from '../store/agents.js';
import { getTasksByReceiver } from '../store/tasks.js';
import { getMessageCount } from '../store/messages.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  _bridgeDir: string,
): void {
  server.tool(
    'peer_inbox',
    'List tasks addressed to this agent',
    {
      status: z
        .enum(['pending', 'active', 'waiting_reply', 'completed', 'failed', 'cancelled', 'expired'])
        .optional()
        .describe('Optional filter by task status'),
    },
    async (args) => {
      try {
        updateLastSeen(db, agentName);

        let tasks = getTasksByReceiver(
          db,
          agentName,
          args.status as TaskStatus | undefined,
        );

        if (!args.status) {
          tasks = tasks.filter((t) => !isTerminal(t.status as TaskStatus));
        }

        const result = tasks.map((task) => ({
          id: task.id,
          task_type: task.task_type,
          sender: task.sender,
          summary: task.summary,
          status: task.status,
          message_count: getMessageCount(db, task.id),
          updated_at: task.updated_at,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
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
