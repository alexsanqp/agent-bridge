import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { findProjectRoot, resolveBridgeDir, toForwardSlashes } from '../utils/paths.js';
import { loadConfig } from '../config/loader.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import type { BridgeConfig } from '../config/loader.js';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

const CLIENT_MCP_PATHS: Record<string, string> = {
  'cursor': '.cursor/mcp.json',
  'claude-code': '.mcp.json',
  'codex': '.codex/config.toml',
};

function formatResult(result: CheckResult): string {
  const icon = result.passed ? '✓' : '✗';
  return `${icon} ${result.name}: ${result.message}`;
}

function checkProjectRoot(): CheckResult {
  try {
    const root = findProjectRoot();
    return { name: 'Project root found', passed: true, message: root };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'Project root found', passed: false, message: msg };
  }
}

function checkBridgeDir(projectRoot: string): CheckResult {
  const bridgeDir = resolveBridgeDir(projectRoot);
  const exists = fs.existsSync(bridgeDir);
  return {
    name: 'Bridge directory exists',
    passed: exists,
    message: exists ? '.agent-bridge/' : `.agent-bridge/ not found in ${projectRoot}`,
  };
}

function checkConfig(bridgeDir: string): CheckResult & { config?: BridgeConfig } {
  try {
    const config = loadConfig(bridgeDir);
    return { name: 'config.yaml is valid', passed: true, message: 'parsed successfully', config };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'config.yaml is valid', passed: false, message: msg };
  }
}

function checkDatabase(bridgeDir: string): CheckResult {
  try {
    const db = openDatabase(bridgeDir);
    closeDatabase(db);
    return { name: 'bridge.db is accessible', passed: true, message: 'opened and closed successfully' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'bridge.db is accessible', passed: false, message: msg };
  }
}

function checkMcpConfigs(projectRoot: string, config: BridgeConfig): CheckResult[] {
  const results: CheckResult[] = [];

  for (const agent of config.agents) {
    const relativePath = CLIENT_MCP_PATHS[agent.client];
    if (!relativePath) {
      results.push({
        name: `MCP config for ${agent.name}`,
        passed: false,
        message: `unknown client type: ${agent.client}`,
      });
      continue;
    }

    const fullPath = toForwardSlashes(path.join(projectRoot, relativePath));
    const exists = fs.existsSync(fullPath);
    results.push({
      name: exists
        ? `MCP config exists for ${agent.name}`
        : `MCP config missing for ${agent.name}`,
      passed: exists,
      message: exists ? `(${relativePath})` : `(${relativePath}) not found`,
    });
  }

  return results;
}

function checkBinaryPaths(projectRoot: string, config: BridgeConfig): CheckResult[] {
  const results: CheckResult[] = [];
  const checked = new Set<string>();

  for (const agent of config.agents) {
    const relativePath = CLIENT_MCP_PATHS[agent.client];
    if (!relativePath) continue;

    const fullPath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(fullPath)) continue;

    if (checked.has(fullPath)) continue;
    checked.add(fullPath);

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');

      if (relativePath.endsWith('.json')) {
        const parsed = JSON.parse(content);
        const servers = parsed.mcpServers ?? parsed.servers ?? {};

        for (const [serverName, serverConfig] of Object.entries(servers)) {
          const cfg = serverConfig as Record<string, unknown>;
          const command = (cfg.command as string) ?? '';
          if (!command) continue;

          const commandExists = fs.existsSync(command);
          results.push({
            name: `Binary path valid (${serverName})`,
            passed: commandExists,
            message: commandExists ? command : `${command} not found`,
          });
        }
      } else if (relativePath.endsWith('.toml')) {
        const commandMatch = content.match(/command\s*=\s*"([^"]+)"/);
        if (commandMatch) {
          const command = commandMatch[1];
          const commandExists = fs.existsSync(command);
          results.push({
            name: `Binary path valid (${relativePath})`,
            passed: commandExists,
            message: commandExists ? command : `Not found: ${command}`,
          });
        }
      }
    } catch {
      // Skip unparseable MCP configs — already flagged by checkMcpConfigs
    }
  }

  return results;
}

function checkBinaryVersion(results: CheckResult[], binaryPath: string): void {
  try {
    const output = execSync(`"${binaryPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
    results.push({ name: 'Binary version check', passed: true, message: `Version: ${output}` });
  } catch {
    results.push({ name: 'Binary version check', passed: false, message: 'Could not determine binary version' });
  }
}

export async function runDoctor(): Promise<void> {
  const results: CheckResult[] = [];

  console.log('Agent Bridge Doctor');
  console.log('==================\n');

  // 1. Project root
  const rootResult = checkProjectRoot();
  results.push(rootResult);

  if (!rootResult.passed) {
    console.log(formatResult(rootResult));
    printSummary(results);
    return;
  }

  const projectRoot = rootResult.message;
  const bridgeDir = resolveBridgeDir(projectRoot);

  // 2. Bridge directory
  const dirResult = checkBridgeDir(projectRoot);
  results.push(dirResult);

  // 3. Config
  const configResult = checkConfig(bridgeDir);
  results.push(configResult);

  // 4. Database
  const dbResult = checkDatabase(bridgeDir);
  results.push(dbResult);

  // 5. MCP configs
  if (configResult.config) {
    const mcpResults = checkMcpConfigs(projectRoot, configResult.config);
    results.push(...mcpResults);

    // 6. Binary paths
    const binaryResults = checkBinaryPaths(projectRoot, configResult.config);
    results.push(...binaryResults);

    // 7. Binary version check
    for (const br of binaryResults) {
      if (br.passed) {
        checkBinaryVersion(results, br.message);
        break; // only check version once
      }
    }
  }

  for (const result of results) {
    console.log(formatResult(result));
  }

  printSummary(results);
}

function printSummary(results: CheckResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  console.log(`\nResults: ${passed}/${results.length} checks passed`);
}
