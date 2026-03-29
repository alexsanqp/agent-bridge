import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { BridgeError } from '../domain/errors.js';
import { updateLastSeen } from '../store/agents.js';
import { getTask } from '../store/tasks.js';
import { getNewMessages, getMessagesByTask } from '../store/messages.js';

export function register(server: McpServer, db: BetterSqlite3.Database, agentName: string, _bridgeDir: string): void {
  server.tool(
    'peer_check',
    'Quick check for new activity on a task without fetching full message content. Use this for lightweight polling instead of peer_wait.',
    {
      task_id: z.string().describe('ID of the task to check'),
      since: z.string().optional().describe('ISO timestamp — count only messages newer than this'),
    },
    async (args) => {
      try {
        updateLastSeen(db, agentName);

        const task = getTask(db, args.task_id);
        if (!task) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'TASK_NOT_FOUND', message: `Task '${args.task_id}' not found` }) }],
            isError: true,
          };
        }

        const messages = args.since
          ? getNewMessages(db, args.task_id, args.since)
          : getMessagesByTask(db, args.task_id);

        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              task_id: task.id,
              status: task.status,
              new_message_count: messages.length,
              last_activity: lastMessage?.created_at ?? task.updated_at,
              sender: task.sender,
              receiver: task.receiver,
            }),
          }],
        };
      } catch (err) {
        if (err instanceof BridgeError) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.code, message: err.message }) }], isError: true };
        }
        throw err;
      }
    },
  );
}
