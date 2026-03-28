import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { toForwardSlashes } from '../utils/paths.js';

export interface AgentConfig {
  name: string;
  role: string;
  client: string;
}

export interface BridgeConfig {
  version: number;
  agents: AgentConfig[];
  policies: {
    blocked_patterns: string[];
    max_artifact_size_kb: number;
  };
  expiration_minutes: number;
}

export function loadConfig(bridgeDir: string): BridgeConfig {
  const configPath = toForwardSlashes(path.join(bridgeDir, 'config.yaml'));

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  return YAML.parse(raw) as BridgeConfig;
}

export function getDefaultConfig(agents: AgentConfig[]): BridgeConfig {
  return {
    version: 1,
    agents,
    policies: {
      blocked_patterns: ['**/.env', '**/*.key', '**/*.pem'],
      max_artifact_size_kb: 512,
    },
    expiration_minutes: 30,
  };
}

export function saveConfig(bridgeDir: string, config: BridgeConfig): void {
  const configPath = toForwardSlashes(path.join(bridgeDir, 'config.yaml'));
  fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');
}
