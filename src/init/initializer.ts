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
  writeMcpConfig,
  writeRolePrompt,
} from './generator.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { upsertAgent } from '../store/agents.js';
import { saveConfig, getDefaultConfig } from '../config/loader.js';
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

export async function runInit(opts: { force?: boolean; detect?: boolean }): Promise<void> {
  const detect = opts.detect !== false;

  // 1. Find project root
  const projectRoot = findProjectRoot();
  console.log(`Project root: ${projectRoot}`);

  // 2. Resolve bridge dir
  const bridgeDir = resolveBridgeDir(projectRoot);

  // 3. Detect binary path
  const binaryPath = resolveBinaryPath();
  console.log(`Binary path: ${binaryPath}`);

  // 4. Detect clients
  const clients = detect ? detectClients(projectRoot) : [];
  const detectedClients = clients.filter((c) => c.detected);

  if (detect) {
    console.log('\nDetected clients:');
    for (const client of clients) {
      const marker = client.detected ? '[x]' : '[ ]';
      console.log(`  ${marker} ${client.name} — ${client.reason}`);
    }
  }

  // Interactive prompting: customize detected clients or manual entry
  for (const client of detectedClients) {
    client.defaultAgentName = await prompt(`Agent name for ${client.name}`, client.defaultAgentName);
    client.defaultRole = await prompt(`Role for ${client.defaultAgentName}`, client.defaultRole);
  }

  if (!detect || detectedClients.length === 0) {
    console.log('No clients detected. Enter agent configuration manually.');
    const name = await prompt('Agent name', 'agent-1');
    const role = await prompt('Role (developer/reviewer/tester/architect)', 'developer');
    const client = await prompt('Client (cursor/claude-code/codex)', 'cursor');
    detectedClients.push({ name: client, detected: false, reason: 'manual', defaultAgentName: name, defaultRole: role });
  }

  // 5. Build agent list from detected clients
  const agents = detectedClients.map((c) => ({
    name: c.defaultAgentName,
    role: c.defaultRole,
    client: c.name,
  }));

  // 6. Create .agent-bridge/ directory
  ensureDir(bridgeDir);
  console.log(`\nCreated: ${bridgeDir}/`);

  // 7. Generate and write config.yaml
  const configPath = path.join(bridgeDir, 'config.yaml');
  const config = getDefaultConfig(agents);
  if (!fs.existsSync(configPath) || opts.force) {
    saveConfig(bridgeDir, config);
    console.log(`Created: ${toForwardSlashes(configPath)}`);
  } else {
    console.log(`Skipped: ${toForwardSlashes(configPath)} (already exists, use --force to overwrite)`);
  }

  // 8. Generate and write MCP configs for each detected client
  for (const client of detectedClients) {
    const mcpContent = generateMcpConfig(
      client.name,
      binaryPath,
      client.defaultAgentName,
      bridgeDir,
    );
    const mcpTargetPath = getMcpConfigPath(client.name, projectRoot);
    const mcpExists = fs.existsSync(mcpTargetPath);
    if (mcpExists) {
      showDiff(mcpTargetPath, mcpContent);
    }
    writeMcpConfig(client.name, projectRoot, mcpContent);
    console.log(`${mcpExists ? 'Updated' : 'Created'} MCP config for: ${client.name}`);
  }

  // 9. Generate and write role prompts
  for (const agent of agents) {
    const roleContent = generateRolePrompt(agent.name, agent.role, agents);
    const promptPath = path.join(projectRoot, '.agents', `${agent.name}.md`);
    if (fs.existsSync(promptPath) && !opts.force) {
      console.log(`Skipped: ${promptPath} (already exists, use --force to overwrite)`);
    } else {
      const existed = fs.existsSync(promptPath);
      writeRolePrompt(projectRoot, agent.name, roleContent);
      console.log(`${existed ? 'Updated' : 'Created'} role prompt: .agents/${agent.name}.md`);
    }
  }

  // 10. Generate and write AGENTS.md
  if (agents.length > 0) {
    const agentsMdContent = generateAgentsMd(agents);
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

  // 11. Update .gitignore
  updateGitignore(projectRoot);
  console.log('Updated: .gitignore');

  // 12. Open database (creates schema)
  const db = openDatabase(bridgeDir);

  // 13. Register agents in DB
  for (const agent of agents) {
    upsertAgent(db, agent);
    console.log(`Registered agent: ${agent.name} (${agent.role})`);
  }

  // 14. Close database
  closeDatabase(db);

  // 15. Summary
  console.log('\n--- Init complete ---');
  console.log(`  Bridge dir: ${bridgeDir}`);
  console.log(`  Agents: ${agents.length > 0 ? agents.map((a) => a.name).join(', ') : '(none)'}`);
  console.log(`  Clients: ${detectedClients.length > 0 ? detectedClients.map((c) => c.name).join(', ') : '(none)'}`);
}
