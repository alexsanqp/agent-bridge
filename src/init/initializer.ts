import {
  findProjectRoot,
  resolveBridgeDir,
  ensureDir,
  toForwardSlashes,
} from '../utils/paths.js';
import { detectClients } from './detector.js';
import {
  generateMcpConfig,
  generateRolePrompt,
  generateAgentsMd,
  generateSkill,
  writeMcpConfig,
  writeRolePrompt,
  writeSkill,
  writeClaudePointer,
  cleanupLegacyCursorRule,
} from './generator.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { upsertAgent } from '../store/agents.js';
import { saveConfig, getDefaultConfig, loadConfig } from '../config/loader.js';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

async function prompt(question: string, defaultValue: string): Promise<string> {
  // If not TTY (non-interactive), return default
  if (!process.stdin.isTTY) return defaultValue;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function getMcpConfigPath(client: string, projectRoot: string): string {
  switch (client) {
    case 'cursor':
      return path.join(projectRoot, '.cursor', 'mcp.json');
    case 'claude-code':
      return path.join(projectRoot, '.mcp.json');
    case 'codex':
      return path.join(projectRoot, '.codex', 'config.toml');
    default:
      throw new Error(`Unknown client: ${client}`);
  }
}

function showDiff(filePath: string, newContent: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const oldContent = fs.readFileSync(filePath, 'utf-8');
  if (oldContent === newContent) {
    console.log(`Unchanged: ${filePath}`);
    return false;
  }
  console.log(`Changed: ${filePath}`);
  console.log(`  - Old: ${oldContent.length} bytes`);
  console.log(`  + New: ${newContent.length} bytes`);
  return true;
}

const GITIGNORE_ENTRIES = [
  '# Agent Bridge runtime data',
  '.agent-bridge/bridge.db',
  '.agent-bridge/bridge.db-wal',
  '.agent-bridge/bridge.db-shm',
  '.agent-bridge/artifacts/',
  '.agent-bridge/logs/',
];

function resolveBinaryPath(): string {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'where' : 'which';
  const binaryName = isWindows ? 'agent-bridge.exe' : 'agent-bridge';

  try {
    const result = execFileSync(command, [binaryName.replace('.exe', '')], {
      encoding: 'utf-8',
    }).trim();
    // `where` on Windows may return multiple lines, take first
    const firstLine = result.split(/\r?\n/)[0].trim();
    return toForwardSlashes(fs.realpathSync(firstLine));
  } catch {
    // Fallback: resolve from process.argv
    try {
      const argv1 = fs.realpathSync(process.argv[1]);
      // If argv1 is a .js file, look for the binary in the same bin directory
      if (argv1.endsWith('.js')) {
        const binDir = path.dirname(argv1);
        const binaryInBin = path.join(binDir, binaryName);
        if (fs.existsSync(binaryInBin)) {
          return toForwardSlashes(fs.realpathSync(binaryInBin));
        }
      }
      return toForwardSlashes(argv1);
    } catch {
      return toForwardSlashes(process.argv[1]);
    }
  }
}

function updateGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let content = '';

  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  }

  if (content.includes('.agent-bridge/bridge.db')) {
    return;
  }

  const block = '\n' + GITIGNORE_ENTRIES.join('\n') + '\n';
  fs.writeFileSync(gitignorePath, content.trimEnd() + '\n' + block, 'utf-8');
}

export async function runInit(opts: { force?: boolean; detect?: boolean; mode?: string }): Promise<void> {
  const detect = opts.detect !== false;

  // 1. Find project root
  const projectRoot = findProjectRoot();
  console.log(`Project root: ${projectRoot}`);

  // 2. Resolve bridge dir
  const bridgeDir = resolveBridgeDir(projectRoot);

  // 3. Detect binary path
  const binaryPath = resolveBinaryPath();
  console.log(`Binary path: ${binaryPath}`);

  // 4. Resolve agents: from existing config (re-init) or fresh detection
  interface AgentEntry { name: string; role: string; client: string; enabled: boolean; }
  const configPath = path.join(bridgeDir, 'config.yaml');
  let agents: AgentEntry[];

  if (fs.existsSync(configPath) && !opts.force) {
    // Re-init: use agents from existing config (preserves enabled/disabled, roles)
    try {
      const existingConfig = loadConfig(bridgeDir);
      agents = existingConfig.agents.map((a) => ({
        ...a,
        enabled: a.enabled !== false, // backward compat: missing field = enabled
      }));
      console.log(`\nUsing agents from existing config.yaml:`);
      for (const agent of agents) {
        const marker = agent.enabled ? '[x]' : '[ ]';
        console.log(`  ${marker} ${agent.name} (${agent.role}) — ${agent.client}`);
      }
    } catch {
      agents = [];
    }
  } else {
    // Fresh init: detect clients and prompt
    const clients = detect ? detectClients(projectRoot) : [];
    const detectedClients = clients.filter((c) => c.detected);

    if (detect) {
      console.log('\nDetected clients:');
      for (const client of clients) {
        const marker = client.detected ? '[x]' : '[ ]';
        console.log(`  ${marker} ${client.name} — ${client.reason}`);
      }
    }

    agents = [];
    for (const client of detectedClients) {
      const enable = await prompt(`Enable ${client.name}?`, 'Y');
      const enabled = !(enable.toLowerCase() === 'n' || enable.toLowerCase() === 'no');
      const agentName = await prompt(`Agent name for ${client.name}`, client.defaultAgentName);
      const role = await prompt(`Role for ${agentName} (developer/reviewer/tester/architect/etc)`, 'developer');
      agents.push({ name: agentName, role, client: client.name, enabled });
      if (!enabled) console.log(`  Disabled: ${client.name} (can enable later in config.yaml)`);
    }

    if (!detect || detectedClients.length === 0) {
      console.log('No clients detected. Enter agent configuration manually.');
      const name = await prompt('Agent name', 'agent-1');
      const role = await prompt('Role (developer/reviewer/tester/architect/etc)', 'developer');
      const client = await prompt('Client (cursor/claude-code/codex)', 'cursor');
      agents.push({ name, role, client, enabled: true });
    }
  }

  // 5. Separate enabled agents
  const enabledAgents = agents.filter((a) => a.enabled);

  // 6. Create .agent-bridge/ directory
  ensureDir(bridgeDir);
  console.log(`\nCreated: ${bridgeDir}/`);

  // 7. Generate and write config.yaml (preserve autonomy mode on re-init)
  let mode: 'manual' | 'autonomous' = 'manual';

  // Priority: CLI --mode flag > existing config > default
  if (opts.mode === 'manual' || opts.mode === 'autonomous') {
    mode = opts.mode;
  } else if (fs.existsSync(configPath)) {
    try {
      const existingConfig = loadConfig(bridgeDir);
      mode = existingConfig?.autonomy?.mode ?? 'manual';
    } catch { /* ignore parse errors */ }
  }

  const config = getDefaultConfig(agents);
  config.autonomy.mode = mode;
  if (!fs.existsSync(configPath) || opts.force) {
    saveConfig(bridgeDir, config);
    console.log(`Created: ${toForwardSlashes(configPath)}`);
  } else {
    console.log(`Skipped: ${toForwardSlashes(configPath)} (already exists, use --force to overwrite)`);
  }

  // 8. Generate MCP configs only for ENABLED agents
  for (const agent of enabledAgents) {
    const mcpContent = generateMcpConfig(agent.client, binaryPath, agent.name, bridgeDir);
    const mcpTargetPath = getMcpConfigPath(agent.client, projectRoot);
    const mcpExists = fs.existsSync(mcpTargetPath);
    if (mcpExists) {
      showDiff(mcpTargetPath, mcpContent);
    }
    writeMcpConfig(agent.client, projectRoot, mcpContent);
    console.log(`${mcpExists ? 'Updated' : 'Created'} MCP config for: ${agent.client}`);
  }

  // 9. Generate and write unified skill (includes ALL agents in peer list)
  const skillContent = generateSkill(agents, mode);
  writeSkill(projectRoot, skillContent);
  console.log('Created: .agents/skills/peer-collaborate/SKILL.md');
  console.log('Created: .claude/skills/peer-collaborate/SKILL.md');

  // 10. Write minimal CLAUDE.md pointer (idempotent)
  writeClaudePointer(projectRoot);
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  const claudeVerb = fs.existsSync(claudeMdPath) ? 'Updated' : 'Created';
  console.log(`${claudeVerb}: CLAUDE.md (Agent Bridge pointer)`);

  // 11. Clean up legacy .cursor/rules/agent-bridge.mdc if exists
  if (cleanupLegacyCursorRule(projectRoot)) {
    console.log('Removed legacy: .cursor/rules/agent-bridge.mdc');
  }

  // 12. Generate AGENTS.md with ALL agents (enabled and disabled)
  if (agents.length > 0) {
    const agentsMdContent = generateAgentsMd(agents, mode);
    const agentsMdPath = path.join(projectRoot, 'AGENTS.md');
    if (fs.existsSync(agentsMdPath) && !opts.force) {
      showDiff(agentsMdPath, agentsMdContent);
      console.log(`Skipped: AGENTS.md (already exists, use --force to overwrite)`);
    } else {
      const existed = fs.existsSync(agentsMdPath);
      fs.writeFileSync(agentsMdPath, agentsMdContent, 'utf-8');
      console.log(`${existed ? 'Updated' : 'Created'}: AGENTS.md`);
    }
  }

  // 13. Update .gitignore
  updateGitignore(projectRoot);
  console.log('Updated: .gitignore');

  // 14. Open database (creates schema)
  const db = openDatabase(bridgeDir);

  // 15. Register only ENABLED agents in DB
  for (const agent of enabledAgents) {
    upsertAgent(db, agent);
    console.log(`Registered agent: ${agent.name} (${agent.role})`);
  }
  for (const agent of agents.filter((a) => !a.enabled)) {
    console.log(`Skipped agent: ${agent.name} (disabled)`);
  }

  // 16. Close database
  closeDatabase(db);

  // 17. Summary
  const enabledNames = enabledAgents.map((a) => a.name);
  const disabledNames = agents.filter((a) => !a.enabled).map((a) => a.name);
  console.log('\n--- Init complete ---');
  console.log(`  Bridge dir: ${bridgeDir}`);
  console.log(`  Enabled: ${enabledNames.length > 0 ? enabledNames.join(', ') : '(none)'}`);
  if (disabledNames.length > 0) {
    console.log(`  Disabled: ${disabledNames.join(', ')} (enable in config.yaml)`);
  }
}
