import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { findProjectRoot, resolveBridgeDir } from '../utils/paths.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { getTasksByReceiver } from '../store/tasks.js';
import { getAgents } from '../store/agents.js';
import { loadConfig } from '../config/loader.js';
import { TaskStatus } from '../domain/models.js';
import type { AgentConfig } from '../config/loader.js';

export interface WatchOptions {
  interval?: number;
  verbose?: boolean;
}

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

function getClientCommand(client: string): string | null {
  switch (client) {
    case 'claude-code': return 'claude';
    case 'codex': return 'codex';
    default: return null;
  }
}

function getTriggerArgs(client: string): string[] {
  if (client === 'claude-code') {
    return ['-p', '/peer-collaborate', '--continue'];
  }
  if (client === 'codex') {
    return ['exec', '/peer-collaborate'];
  }
  return [];
}

function triggerAgent(command: string, args: string[], projectRoot: string, verbose: boolean): void {
  const child = spawn(command, args, {
    cwd: projectRoot,
    detached: true,
    stdio: verbose ? 'inherit' : 'ignore',
    shell: process.platform === 'win32',
  });
  child.unref();
  child.on('error', (err) => {
    if (verbose) log(`Trigger error: ${err.message}`);
  });
}

function log(msg: string): void {
  console.log(`[watch] ${new Date().toISOString()} ${msg}`);
}

function logVerbose(msg: string, verbose: boolean): void {
  if (verbose) log(msg);
}

function allAgentsOffline(db: BetterSqlite3.Database): boolean {
  const agents = getAgents(db);
  if (agents.length === 0) return true;
  const now = Date.now();
  return agents.every(a => (now - new Date(a.last_seen).getTime()) > ACTIVE_THRESHOLD_MS);
}

// --- PID file management ---

function getPidPath(bridgeDir: string): string {
  return path.join(bridgeDir, 'coordinator.pid');
}

export function isCoordinatorRunning(bridgeDir: string): boolean {
  const pidPath = getPidPath(bridgeDir);
  if (!fs.existsSync(pidPath)) return false;
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    process.kill(pid, 0); // signal 0 = check if process exists
    return true;
  } catch {
    // Process not running, stale PID file
    try { fs.unlinkSync(pidPath); } catch { /* ignore */ }
    return false;
  }
}

function writePidFile(bridgeDir: string): void {
  fs.writeFileSync(getPidPath(bridgeDir), String(process.pid), 'utf-8');
}

function removePidFile(bridgeDir: string): void {
  try { fs.unlinkSync(getPidPath(bridgeDir)); } catch { /* ignore */ }
}

// --- Spawn coordinator from MCP server ---

export function ensureCoordinatorRunning(bridgeDir: string, projectRoot: string): void {
  if (isCoordinatorRunning(bridgeDir)) return;

  const binaryPath = process.argv[1]; // path to cli.js
  const child = spawn(process.execPath, [binaryPath, 'watch'], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// --- Poll logic ---

export function pollOnce(
  db: BetterSqlite3.Database,
  agents: AgentConfig[],
  cooldownMs: number,
  lastTriggered: Map<string, number>,
  projectRoot: string,
  verbose: boolean,
): void {
  for (const agent of agents) {
    if (!agent.enabled) continue;

    const command = getClientCommand(agent.client);
    if (!command) continue;

    const pending = getTasksByReceiver(db, agent.name, TaskStatus.Pending);
    if (pending.length === 0) {
      logVerbose(`${agent.name}: no pending tasks`, verbose);
      continue;
    }

    const lastTrigger = lastTriggered.get(agent.name) ?? 0;
    const elapsed = Date.now() - lastTrigger;
    if (elapsed < cooldownMs) {
      logVerbose(`${agent.name}: cooldown (${Math.ceil((cooldownMs - elapsed) / 1000)}s remaining)`, verbose);
      continue;
    }

    const args = getTriggerArgs(agent.client);
    log(`Triggered ${agent.name} (${agent.client}) — ${pending.length} pending task(s)`);
    triggerAgent(command, args, projectRoot, verbose);
    lastTriggered.set(agent.name, Date.now());
  }
}

// --- Main daemon ---

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

  // Check if already running
  if (isCoordinatorRunning(bridgeDir)) {
    console.error('[watch] Coordinator already running.');
    process.exit(0);
  }

  const enabledAgents = config.agents.filter((a) => a.enabled !== false);
  if (enabledAgents.length === 0) {
    console.error('[watch] No enabled agents found.');
    process.exit(1);
  }

  const triggerableAgents = enabledAgents.filter(a => getClientCommand(a.client));
  if (triggerableAgents.length === 0) {
    console.error('[watch] No triggerable agents (only claude-code and codex supported).');
    process.exit(1);
  }

  const db = openDatabase(bridgeDir);
  const intervalMs = opts.interval ?? config.coordinator?.poll_interval_ms ?? 5000;
  const cooldownMs = config.coordinator?.cooldown_ms ?? 30000;
  const verbose = opts.verbose ?? false;
  const lastTriggered = new Map<string, number>();

  writePidFile(bridgeDir);

  log(`Started — polling every ${intervalMs}ms, cooldown ${cooldownMs / 1000}s`);
  log(`Watching: ${triggerableAgents.map(a => `${a.name} (${a.client})`).join(', ')}`);

  const unsupported = enabledAgents.filter(a => !getClientCommand(a.client));
  for (const agent of unsupported) {
    log(`Skipping ${agent.name} (${agent.client}) — no local trigger`);
  }

  let running = true;

  function shutdown(): void {
    if (!running) return;
    running = false;
    log('Shutting down...');
    removePidFile(bridgeDir);
    closeDatabase(db);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      pollOnce(db, enabledAgents, cooldownMs, lastTriggered, projectRoot, verbose);

      // Auto-shutdown if all agents offline
      if (allAgentsOffline(db)) {
        log('All agents offline — shutting down');
        shutdown();
      }
    } catch (err) {
      console.error(`[watch] Poll error: ${(err as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
