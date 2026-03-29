import { spawn, execFileSync } from 'node:child_process';
import type BetterSqlite3 from 'better-sqlite3';
import { findProjectRoot, resolveBridgeDir } from '../utils/paths.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { getTasksByReceiver } from '../store/tasks.js';
import { loadConfig } from '../config/loader.js';
import { TaskStatus } from '../domain/models.js';
import type { AgentConfig } from '../config/loader.js';

export interface WatchOptions {
  interval?: number;
  verbose?: boolean;
}

interface ClientTrigger {
  command: string;
  args: string[];
}

const TRIGGER_PROMPT = 'You have new tasks in Agent Bridge. Check your inbox by calling peer_inbox, then process each pending task with peer_get_task and peer_reply.';

function getClientCommand(client: string): string | null {
  switch (client) {
    case 'claude-code': return 'claude';
    case 'codex': return 'codex';
    case 'cursor': return null;
    default: return null;
  }
}

function buildTriggerArgs(client: string, sessionId: string | null): string[] {
  if (client === 'claude-code') {
    const args = ['-p', TRIGGER_PROMPT, '--output-format', 'json', '--allowedTools', 'mcp__agent-bridge__peer_inbox,mcp__agent-bridge__peer_get_task,mcp__agent-bridge__peer_reply,mcp__agent-bridge__peer_complete,mcp__agent-bridge__peer_status,mcp__agent-bridge__peer_check'];
    if (sessionId) {
      args.push('--resume', sessionId);
    }
    return args;
  }
  if (client === 'codex') {
    const args = ['exec', TRIGGER_PROMPT];
    if (sessionId) {
      args.push('resume', sessionId);
    }
    return args;
  }
  return [];
}

function triggerAgent(
  command: string,
  args: string[],
  agentName: string,
  projectRoot: string,
  verbose: boolean,
  sessionStore: Map<string, string>,
): void {
  try {
    // Run synchronously to capture session ID from output
    const result = execFileSync(command, args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 120000, // 2 min max
      shell: process.platform === 'win32',
    });

    // Try to extract session_id from JSON output (claude -p --output-format json)
    try {
      const parsed = JSON.parse(result);
      if (parsed.session_id) {
        sessionStore.set(agentName, parsed.session_id);
        if (verbose) {
          log(`${agentName}: captured session ${parsed.session_id}`);
        }
      }
    } catch { /* not JSON or no session_id — OK */ }
  } catch (err) {
    if (verbose) {
      log(`Error triggering ${agentName}: ${(err as Error).message}`);
    }
  }
}

function log(msg: string): void {
  console.log(`[watch] ${new Date().toISOString()} ${msg}`);
}

function logVerbose(msg: string, verbose: boolean): void {
  if (verbose) {
    log(msg);
  }
}

export function pollOnce(
  db: BetterSqlite3.Database,
  agents: AgentConfig[],
  cooldownMs: number,
  lastTriggered: Map<string, number>,
  sessionStore: Map<string, string>,
  projectRoot: string,
  verbose: boolean,
): void {
  for (const agent of agents) {
    if (!agent.enabled) continue;

    const pending = getTasksByReceiver(db, agent.name, TaskStatus.Pending);

    if (pending.length === 0) {
      logVerbose(`${agent.name}: no pending tasks`, verbose);
      continue;
    }

    const lastTrigger = lastTriggered.get(agent.name) ?? 0;
    const elapsed = Date.now() - lastTrigger;
    if (elapsed < cooldownMs) {
      logVerbose(
        `${agent.name}: cooldown (${Math.ceil((cooldownMs - elapsed) / 1000)}s remaining)`,
        verbose,
      );
      continue;
    }

    const command = getClientCommand(agent.client);
    if (!command) {
      log(`${agent.name}: ${agent.client} local trigger not supported`);
      continue;
    }

    const sessionId = sessionStore.get(agent.name) ?? null;
    const args = buildTriggerArgs(agent.client, sessionId);

    log(`Triggering ${agent.name} (${agent.client}) — ${pending.length} pending task(s)${sessionId ? ` [session: ${sessionId.slice(0, 8)}...]` : ' [new session]'}`);
    triggerAgent(command, args, agent.name, projectRoot, verbose, sessionStore);
    lastTriggered.set(agent.name, Date.now());
  }
}

export async function runWatch(opts: WatchOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  const bridgeDir = resolveBridgeDir(projectRoot);

  let config;
  try {
    config = loadConfig(bridgeDir);
  } catch {
    console.error('[watch] Bridge not initialized. Run: agent-bridge init');
    process.exit(1);
  }

  const enabledAgents = config.agents.filter((a) => a.enabled !== false);
  if (enabledAgents.length === 0) {
    console.error('[watch] No enabled agents found. Nothing to watch.');
    process.exit(1);
  }

  const db = openDatabase(bridgeDir);
  const intervalMs = opts.interval ?? config.coordinator?.poll_interval_ms ?? 5000;
  const cooldownMs = config.coordinator?.cooldown_ms ?? 30000;
  const verbose = opts.verbose ?? false;
  const lastTriggered = new Map<string, number>();
  const sessionStore = new Map<string, string>();

  log(`Started — polling every ${intervalMs}ms, cooldown ${cooldownMs / 1000}s`);
  log(`Watching ${enabledAgents.length} agent(s): ${enabledAgents.map((a) => a.name).join(', ')}`);

  // Warn about unsupported clients
  for (const agent of enabledAgents) {
    if (!getClientCommand(agent.client)) {
      log(`Warning: ${agent.name} (${agent.client}) — local trigger not supported, will skip`);
    }
  }

  let running = true;

  function shutdown(): void {
    if (!running) return;
    running = false;
    log('Shutting down...');
    closeDatabase(db);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      pollOnce(db, enabledAgents, cooldownMs, lastTriggered, sessionStore, projectRoot, verbose);
    } catch (err) {
      console.error(`[watch] Poll error: ${(err as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
