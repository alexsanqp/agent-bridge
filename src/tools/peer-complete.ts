import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { BridgeError } from '../domain/errors.js';
import { updateLastSeen } from '../store/agents.js';
import { getTask, updateTaskStatus } from '../store/tasks.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  _bridgeDir: string,
): void {
  server.tool(
    'peer_complete',
    'Mark a task as completed',
    {
      task_id: z.string().describe('ID of the task to complete'),
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

        updateTaskStatus(db, args.task_id, TaskStatus.Completed);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'completed' }),
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
