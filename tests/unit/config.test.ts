import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
} from '../../src/config/loader.js';
import type { AgentConfig, BridgeConfig } from '../../src/config/loader.js';

let tmpDir: string;
let bridgeDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-config-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  fs.mkdirSync(bridgeDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('reads valid config.yaml correctly', () => {
    const config: BridgeConfig = {
      version: 1,
      agents: [{ name: 'test-agent', role: 'developer', client: 'cursor' }],
      policies: {
        blocked_patterns: ['*.env'],
        max_artifact_size_kb: 512,
      },
      expiration_minutes: 15,
    };
    const configPath = path.join(bridgeDir, 'config.yaml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');

    const loaded = loadConfig(bridgeDir);

    expect(loaded.version).toBe(1);
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0].name).toBe('test-agent');
    expect(loaded.agents[0].role).toBe('developer');
    expect(loaded.agents[0].client).toBe('cursor');
    expect(loaded.policies.blocked_patterns).toEqual(['*.env']);
    expect(loaded.policies.max_artifact_size_kb).toBe(512);
    expect(loaded.expiration_minutes).toBe(15);
  });

  it('throws on missing file', () => {
    expect(() => loadConfig(bridgeDir)).toThrow(/Config not found/);
  });

  it('handles malformed YAML gracefully', () => {
    const configPath = path.join(bridgeDir, 'config.yaml');
    // Write content that YAML.parse will handle — it may return a string or null
    // but the result won't conform to BridgeConfig shape
    fs.writeFileSync(configPath, '{ invalid yaml: [unmatched', 'utf-8');

    // YAML.parse may throw on truly broken syntax
    expect(() => loadConfig(bridgeDir)).toThrow();
  });
});

describe('getDefaultConfig', () => {
  it('returns correct expiration default of 30 minutes', () => {
    const agents: AgentConfig[] = [];
    const config = getDefaultConfig(agents);

    expect(config.expiration_minutes).toBe(30);
  });

  it('returns correct max artifact size default of 1024 KB', () => {
    const config = getDefaultConfig([]);

    expect(config.policies.max_artifact_size_kb).toBe(1024);
  });

  it('returns all 16 blocked patterns', () => {
    const config = getDefaultConfig([]);

    expect(config.policies.blocked_patterns).toHaveLength(16);
    expect(config.policies.blocked_patterns).toContain('*.env');
    expect(config.policies.blocked_patterns).toContain('*.key');
    expect(config.policies.blocked_patterns).toContain('*.pem');
    expect(config.policies.blocked_patterns).toContain('id_rsa*');
    expect(config.policies.blocked_patterns).toContain('**/credentials.json');
    expect(config.policies.blocked_patterns).toContain('**/.aws/credentials');
    expect(config.policies.blocked_patterns).toContain('**/.ssh/*');
    expect(config.policies.blocked_patterns).toContain('**/secrets.*');
    expect(config.policies.blocked_patterns).toContain('**/.secret*');
  });

  it('returns version 1', () => {
    const config = getDefaultConfig([]);
    expect(config.version).toBe(1);
  });

  it('includes provided agents', () => {
    const agents: AgentConfig[] = [
      { name: 'cursor-dev', role: 'developer', client: 'cursor' },
      { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' },
    ];
    const config = getDefaultConfig(agents);

    expect(config.agents).toHaveLength(2);
    expect(config.agents[0].name).toBe('cursor-dev');
    expect(config.agents[1].name).toBe('claude-reviewer');
  });
});

describe('saveConfig', () => {
  it('writes and reads back correctly', () => {
    const agents: AgentConfig[] = [
      { name: 'my-agent', role: 'tester', client: 'codex' },
    ];
    const config = getDefaultConfig(agents);

    saveConfig(bridgeDir, config);

    const loaded = loadConfig(bridgeDir);
    expect(loaded.version).toBe(config.version);
    expect(loaded.agents).toEqual(config.agents);
    expect(loaded.policies).toEqual(config.policies);
    expect(loaded.expiration_minutes).toBe(config.expiration_minutes);
  });

  it('overwrites existing config', () => {
    const config1 = getDefaultConfig([]);
    config1.expiration_minutes = 10;
    saveConfig(bridgeDir, config1);

    const config2 = getDefaultConfig([]);
    config2.expiration_minutes = 60;
    saveConfig(bridgeDir, config2);

    const loaded = loadConfig(bridgeDir);
    expect(loaded.expiration_minutes).toBe(60);
  });
});

describe('AgentConfig structure', () => {
  it('has required fields: name, role, client', () => {
    const agent: AgentConfig = {
      name: 'test-agent',
      role: 'developer',
      client: 'cursor',
    };

    expect(agent).toHaveProperty('name');
    expect(agent).toHaveProperty('role');
    expect(agent).toHaveProperty('client');
  });

  it('is serializable through YAML round-trip', () => {
    const agent: AgentConfig = {
      name: 'cursor-dev',
      role: 'developer',
      client: 'cursor',
    };
    const yaml = YAML.stringify(agent);
    const parsed = YAML.parse(yaml) as AgentConfig;

    expect(parsed.name).toBe(agent.name);
    expect(parsed.role).toBe(agent.role);
    expect(parsed.client).toBe(agent.client);
  });
});
