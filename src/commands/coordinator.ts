import { spawn } from 'node:child_process';
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

function getClientTrigger(client: string): ClientTrigger | null {
  switch (client) {
    case 'claude-code':
      return {
        command: 'claude',
        args: ['-p', 'You have new tasks in Agent Bridge. Run: peer_inbox', '--continue'],
      };
    case 'codex':
      return {
        command: 'codex',
        args: ['exec', 'You have new tasks in Agent Bridge. Run: peer_inbox'],
      };
    case 'cursor':
      return null;
    default:
      return null;
  }
}

function triggerAgent(trigger: ClientTrigger, agentName: string, verbose: boolean): void {
  const child = spawn(trigger.command, trigger.args, {
    detached: false,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  child.unref();

  child.on('error', (err) => {
    if (verbose) {
      log(`Error triggering ${agentName}: ${err.message}`);
    }
  });
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

    const trigger = getClientTrigger(agent.client);
    if (!trigger) {
      log(`${agent.name}: ${agent.client} local trigger not supported`);
      continue;
    }

    triggerAgent(trigger, agent.name, verbose);
    lastTriggered.set(agent.name, Date.now());
    log(`Triggered ${agent.name} (${agent.client}) — ${pending.length} pending task(s)`);
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

  log(`Started — polling every ${intervalMs}ms, cooldown ${cooldownMs / 1000}s`);
  log(`Watching ${enabledAgents.length} agent(s): ${enabledAgents.map((a) => a.name).join(', ')}`);

  // Warn about unsupported clients
  for (const agent of enabledAgents) {
    if (!getClientTrigger(agent.client)) {
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
      pollOnce(db, enabledAgents, cooldownMs, lastTriggered, verbose);
    } catch (err) {
      console.error(`[watch] Poll error: ${(err as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
