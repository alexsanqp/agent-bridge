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
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000; // shutdown after 10min with no activity

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
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
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
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
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

  // Resolve the agent-bridge binary
  const isWindows = process.platform === 'win32';
  const child = spawn('agent-bridge', ['watch'], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    shell: isWindows, // needed for .cmd shims on Windows
    windowsHide: true, // prevents CMD window flash on Windows
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

  if (isCoordinatorRunning(bridgeDir)) {
    log('Coordinator already running.');
    process.exit(0);
  }

  const enabledAgents = config.agents.filter((a) => a.enabled !== false);
  if (enabledAgents.length === 0) {
    console.error('[watch] No enabled agents found.');
    process.exit(1);
  }

  const db = openDatabase(bridgeDir);
  const intervalMs = opts.interval ?? config.coordinator?.poll_interval_ms ?? 5000;
  const cooldownMs = config.coordinator?.cooldown_ms ?? 30000;
  const verbose = opts.verbose ?? false;
  const lastTriggered = new Map<string, number>();
  let lastActivity = Date.now(); // tracks last time we saw any online agent or triggered

  writePidFile(bridgeDir);

  log(`Started (pid ${process.pid}) — polling every ${intervalMs / 1000}s, cooldown ${cooldownMs / 1000}s`);

  const triggerableNames = enabledAgents
    .filter(a => getClientCommand(a.client))
    .map(a => `${a.name} (${a.client})`);
  const untriggerableNames = enabledAgents
    .filter(a => !getClientCommand(a.client))
    .map(a => `${a.name} (${a.client})`);

  if (triggerableNames.length > 0) log(`Watching: ${triggerableNames.join(', ')}`);
  if (untriggerableNames.length > 0) log(`Skipping (no local trigger): ${untriggerableNames.join(', ')}`);

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

      // Track activity: if any agent is online, reset idle timer
      if (!allAgentsOffline(db)) {
        lastActivity = Date.now();
      }

      // Auto-shutdown after sustained idle period (no online agents for IDLE_SHUTDOWN_MS)
      if (Date.now() - lastActivity > IDLE_SHUTDOWN_MS) {
        log('No agent activity for 10 minutes — shutting down');
        shutdown();
      }
    } catch (err) {
      console.error(`[watch] Poll error: ${(err as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
