import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskStatus } from '../domain/models.js';
import { BridgeError, BridgeErrorCode } from '../domain/errors.js';
import { isTerminal } from '../domain/status.js';
import { updateLastSeen } from '../store/agents.js';
import { getTask, updateTaskStatus } from '../store/tasks.js';
import { createMessage } from '../store/messages.js';
import { copyArtifact } from '../store/artifacts.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  bridgeDir: string,
): void {
  server.tool(
    'peer_reply',
    'Reply to a task addressed to this agent',
    {
      task_id: z.string().describe('ID of the task to reply to'),
      body: z.string().describe('Reply content'),
      artifacts: z
        .array(z.string())
        .optional()
        .describe('Optional list of file paths to attach as artifacts'),
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

        if (task.receiver !== agentName) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'NOT_RECEIVER',
                  message: `Agent '${agentName}' is not the receiver of task '${args.task_id}'`,
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
                  message: `Task '${args.task_id}' is in terminal state '${task.status}'`,
                }),
              },
            ],
            isError: true,
          };
        }

        const message = createMessage(db, {
          task_id: args.task_id,
          author: agentName,
          kind: 'reply',
          content: args.body,
        });

        const projectRoot = bridgeDir.replace(/[\\/]\.agent-bridge$/, '');

        if (args.artifacts) {
          for (const artifactPath of args.artifacts) {
            copyArtifact(db, artifactPath, args.task_id, message.id, bridgeDir, projectRoot);
          }
        }

        let taskStatus = task.status;
        if (task.status === TaskStatus.WaitingReply) {
          const updated = updateTaskStatus(db, args.task_id, TaskStatus.Active);
          taskStatus = updated.status;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ message_id: message.id, task_status: taskStatus }),
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
