import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface DetectedClient {
  name: string;          // client type: 'cursor' | 'claude-code' | 'codex'
  detected: boolean;
  reason: string;
  defaultAgentName: string;  // generic: 'agent-cursor', 'agent-claude', 'agent-codex'
}

export function isCommandInPath(command: string): boolean {
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(bin, [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectClients(projectRoot: string): DetectedClient[] {
  const clients: DetectedClient[] = [];

  // Cursor
  const cursorDir = path.join(projectRoot, '.cursor');
  const cursorExists = fs.existsSync(cursorDir);
  clients.push({
    name: 'cursor',
    detected: cursorExists,
    reason: cursorExists ? '.cursor/ directory found' : '.cursor/ directory not found',
    defaultAgentName: 'agent-cursor',
  });

  // Claude Code
  const claudeInPath = isCommandInPath('claude');
  clients.push({
    name: 'claude-code',
    detected: claudeInPath,
    reason: claudeInPath ? 'claude binary in PATH' : 'claude binary not found in PATH',
    defaultAgentName: 'agent-claude',
  });

  // Codex CLI
  const codexDir = path.join(projectRoot, '.codex');
  const codexDirExists = fs.existsSync(codexDir);
  const codexInPath = isCommandInPath('codex');
  const codexDetected = codexDirExists || codexInPath;
  const codexReasons: string[] = [];
  if (codexDirExists) codexReasons.push('.codex/ directory found');
  if (codexInPath) codexReasons.push('codex binary in PATH');
  clients.push({
    name: 'codex',
    detected: codexDetected,
    reason: codexDetected
      ? codexReasons.join(', ')
      : '.codex/ directory not found and codex binary not found in PATH',
    defaultAgentName: 'agent-codex',
  });

  return clients;
}
