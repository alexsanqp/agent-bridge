import { findProjectRoot, resolveBridgeDir } from '../utils/paths.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { getActiveTasks } from '../store/tasks.js';
import { getTasksByReceiver } from '../store/tasks.js';
import { getAgents } from '../store/agents.js';
import { loadConfig } from '../config/loader.js';
import { TaskStatus } from '../domain/models.js';

export async function runStatus(): Promise<void> {
  const projectRoot = findProjectRoot();
  const bridgeDir = resolveBridgeDir(projectRoot);

  let config;
  try {
    config = loadConfig(bridgeDir);
  } catch {
    console.log('Agent Bridge is not initialized in this project.');
    console.log('Run "agent-bridge init" to get started.');
    return;
  }

  const db = openDatabase(bridgeDir);

  try {
    const activeTasks = getActiveTasks(db);
    const agents = getAgents(db);

    console.log('=== Agent Bridge Status ===');
    console.log(`Project root: ${projectRoot}`);
    console.log(`Active tasks: ${activeTasks.length}`);
    console.log();

    if (agents.length === 0) {
      console.log('No agents registered yet.');
    } else {
      console.log('Agents:');
      for (const agent of agents) {
        const pending = getTasksByReceiver(db, agent.name, TaskStatus.Pending);
        console.log(
          `  ${agent.name} (${agent.role}) — inbox: ${pending.length} pending, last seen: ${agent.last_seen}`,
        );
      }
    }

    console.log();
    console.log(`Config: v${config.version}, expiration: ${config.expiration_minutes}min`);
  } finally {
    closeDatabase(db);
  }
}
