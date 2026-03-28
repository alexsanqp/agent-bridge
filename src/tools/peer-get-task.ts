import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { BridgeError } from '../domain/errors.js';
import { updateLastSeen } from '../store/agents.js';
import { getTask, updateTaskStatus } from '../store/tasks.js';
import { getMessagesByTask } from '../store/messages.js';
import { getArtifactsByTask } from '../store/artifacts.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  _bridgeDir: string,
): void {
  server.tool(
    'peer_get_task',
    'Get full task details including messages and artifacts',
    {
      task_id: z.string().describe('ID of the task to retrieve'),
    },
    async (args) => {
      try {
        updateLastSeen(db, agentName);

        let task = getTask(db, args.task_id);

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

        if (task.status === TaskStatus.Pending && task.receiver === agentName) {
          task = updateTaskStatus(db, args.task_id, TaskStatus.Active);
        }

        const messages = getMessagesByTask(db, args.task_id);
        const artifacts = getArtifactsByTask(db, args.task_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ task, messages, artifacts }),
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
