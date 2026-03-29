import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { toForwardSlashes } from '../utils/paths.js';
import { DEFAULT_BLOCKED_PATTERNS, DEFAULT_MAX_ARTIFACT_SIZE_KB } from '../domain/policies.js';

export interface AgentConfig {
  name: string;
  role: string;
  client: string;
  enabled: boolean;
}

export interface BridgeConfig {
  version: number;
  agents: AgentConfig[];
  policies: {
    blocked_patterns: string[];
    max_artifact_size_kb: number;
  };
  expiration_minutes: number;
  autonomy: {
    mode: 'manual' | 'autonomous';
  };
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
      blocked_patterns: [...DEFAULT_BLOCKED_PATTERNS],
      max_artifact_size_kb: DEFAULT_MAX_ARTIFACT_SIZE_KB,
    },
    expiration_minutes: 30,
    autonomy: {
      mode: 'manual',
    },
  };
}

export function saveConfig(bridgeDir: string, config: BridgeConfig): void {
  const configPath = toForwardSlashes(path.join(bridgeDir, 'config.yaml'));
  fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');
}
