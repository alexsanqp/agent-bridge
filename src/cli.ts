#!/usr/bin/env node

import fs from 'node:fs';
import { Command } from 'commander';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const program = new Command();

program
  .name('agent-bridge')
  .description('Peer collaboration bridge for AI coding agents')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize agent bridge in the current project')
  .option('--force', 'Overwrite existing configs')
  .option('--no-detect', 'Skip client auto-detection')
  .action(async (opts) => {
    const { runInit } = await import('./init/initializer.js');
    await runInit(opts);
  });

program
  .command('doctor')
  .description('Diagnose project setup')
  .action(async () => {
    const { runDoctor } = await import('./doctor/checks.js');
    await runDoctor();
  });

program
  .command('status')
  .description('Show runtime state')
  .action(async () => {
    const { runStatus } = await import('./commands/status.js');
    await runStatus();
  });

program
  .command('tasks')
  .description('List tasks')
  .option('--status <status>', 'Filter by status')
  .option('--agent <name>', 'Filter by agent')
  .action(async (opts) => {
    const { runTasks } = await import('./commands/tasks.js');
    await runTasks(opts);
  });

program
  .command('reset')
  .description('Clear runtime state')
  .option('--hard', 'Delete everything (fresh start)')
  .action(async (opts) => {
    const { runReset } = await import('./commands/reset.js');
    await runReset(opts);
  });

program
  .command('mcp-server')
  .description('Start MCP stdio server (internal)')
  .requiredOption('--agent <name>', 'Agent name')
  .requiredOption('--bridge-dir <path>', 'Bridge directory path')
  .action(async (opts) => {
    const { startMcpServer } = await import('./mcp-server.js');
    await startMcpServer(opts.agent, opts.bridgeDir);
  });

program
  .command('version')
  .description('Print current version')
  .action(() => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    console.log(pkg.version);
  });

program
  .command('self-update')
  .description('Check for updates and install latest version')
  .action(async () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    const currentVersion = pkg.version;
    console.log(`Current version: ${currentVersion}`);
    console.log('Checking for updates...');
    try {
      const res = await fetch('https://api.github.com/repos/alexsanqp/agent-bridge/releases/latest');
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const data = await res.json() as { tag_name: string };
      const latestVersion = data.tag_name.replace(/^v/, '');
      if (latestVersion === currentVersion) {
        console.log('Already up to date.');
      } else {
        console.log(`New version available: ${latestVersion}`);
        console.log('');
        console.log('Update via npm:        npm update -g @plus-minus/agent-bridge');
        console.log('Update via curl:       curl -fsSL https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.sh | bash');
        console.log('Update via PowerShell: irm https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.ps1 | iex');
      }
    } catch (err) {
      console.error('Failed to check for updates:', (err as Error).message);
      console.log('');
      console.log('Manual update:');
      console.log('  npm update -g @plus-minus/agent-bridge');
    }
  });

program.parse();
