import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { BridgeError } from '../domain/errors.js';
import { isTerminal } from '../domain/status.js';
import { updateLastSeen } from '../store/agents.js';
import { getTask, updateTaskStatus } from '../store/tasks.js';
import { createMessage } from '../store/messages.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  _bridgeDir: string,
): void {
  server.tool(
    'peer_cancel',
    'Cancel a task',
    {
      task_id: z.string().describe('ID of the task to cancel'),
      reason: z.string().optional().describe('Optional reason for cancellation'),
    },
    async (args) => {
      try {
        updateLastSeen(db, agentName);

        const task = getTask(db, args.task_id);
        if (!task) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'TASK_NOT_FOUND',
                  message: `Task '${args.task_id}' not found`,
                }),
              },
            ],
            isError: true,
          };
        }

        if (task.sender !== agentName && task.receiver !== agentName) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'NOT_PARTICIPANT',
                  message: `Agent '${agentName}' is not a participant of task '${args.task_id}'`,
                }),
              },
            ],
            isError: true,
          };
        }

        if (isTerminal(task.status)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'TASK_CLOSED',
                  message: `Task '${args.task_id}' is already in terminal status '${task.status}'`,
                }),
              },
            ],
            isError: true,
          };
        }

        updateTaskStatus(db, args.task_id, TaskStatus.Cancelled);

        if (args.reason) {
          createMessage(db, {
            task_id: args.task_id,
            author: agentName,
            kind: 'note',
            content: args.reason,
          });
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'cancelled' }),
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
