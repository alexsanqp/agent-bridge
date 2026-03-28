import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { BridgeError } from '../domain/errors.js';
import { updateLastSeen } from '../store/agents.js';
import { getTask, updateTaskStatus } from '../store/tasks.js';
import { getNewMessages } from '../store/messages.js';
import { now } from '../utils/time.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  _bridgeDir: string,
): void {
  server.tool(
    'peer_wait',
    'Wait for a reply or status change on a task. Polls until a new message arrives, the status changes, or the timeout is reached.',
    {
      task_id: z.string().describe('ID of the task to watch'),
      timeout_seconds: z
        .number()
        .optional()
        .describe('How long to wait in seconds (default 60, max 300)'),
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

        // Transition to waiting_reply if currently active and caller is sender
        if (task.status === TaskStatus.Active && task.sender === agentName) {
          try {
            updateTaskStatus(db, args.task_id, TaskStatus.WaitingReply);
            task = getTask(db, args.task_id)!;
          } catch { /* ignore if transition not valid */ }
        }

        const timeoutSeconds = Math.min(args.timeout_seconds ?? 60, 300);
        const initialStatus = task.status;
        const initialTimestamp = now();
        const deadline = Date.now() + timeoutSeconds * 1000;

        while (Date.now() < deadline) {
          const newMessages = getNewMessages(db, args.task_id, initialTimestamp);
          if (newMessages.length > 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'reply_received',
                    new_messages: newMessages,
                  }),
                },
              ],
            };
          }

          const currentTask = getTask(db, args.task_id);
          if (currentTask && currentTask.status !== initialStatus) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'status_changed',
                    new_messages: [],
                  }),
                },
              ],
            };
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'timeout' }),
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
