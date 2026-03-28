import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { TaskType } from '../domain/models.js';
import { BridgeError } from '../domain/errors.js';
import { agentExists, updateLastSeen } from '../store/agents.js';
import { createTask } from '../store/tasks.js';
import { createMessage } from '../store/messages.js';
import { copyArtifact } from '../store/artifacts.js';
import { loadConfig } from '../config/loader.js';
import { expiresAt } from '../utils/time.js';

export function register(
  server: McpServer,
  db: BetterSqlite3.Database,
  agentName: string,
  bridgeDir: string,
): void {
  server.tool(
    'peer_send',
    'Create a new task addressed to another agent',
    {
      to: z.string().describe('Name of the receiving agent'),
      task_type: z
        .enum(['review', 'debug', 'test', 'question', 'implement'])
        .describe('Type of task'),
      summary: z.string().describe('Short summary of the task'),
      body: z.string().describe('Full body/description of the task'),
      artifacts: z
        .array(z.string())
        .optional()
        .describe('Optional list of file paths to attach as artifacts'),
    },
    async (args) => {
      try {
        updateLastSeen(db, agentName);

        if (!agentExists(db, args.to)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'UNKNOWN_AGENT',
                  message: `Agent '${args.to}' does not exist`,
                }),
              },
            ],
            isError: true,
          };
        }

        const projectRoot = bridgeDir.replace(/[\\/]\.agent-bridge$/, '');
        const config = loadConfig(bridgeDir);
        const policies = {
          blockedPatterns: config.policies.blocked_patterns,
          maxArtifactSizeKb: config.policies.max_artifact_size_kb,
        };

        const task = createTask(db, {
          task_type: args.task_type as TaskType,
          sender: agentName,
          receiver: args.to,
          summary: args.summary,
          expires_at: expiresAt(config.expiration_minutes),
        });

        const message = createMessage(db, {
          task_id: task.id,
          author: agentName,
          kind: 'request',
          content: args.body,
        });

        if (args.artifacts) {
          for (const artifactPath of args.artifacts) {
            copyArtifact(db, artifactPath, task.id, message.id, bridgeDir, projectRoot, policies);
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ task_id: task.id, status: 'pending' }),
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
