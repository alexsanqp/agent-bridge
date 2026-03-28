#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('agent-bridge')
  .description('Peer collaboration bridge for AI coding agents')
  .version('0.1.0');

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
    console.log('0.1.0');
  });

program
  .command('self-update')
  .description('Check for updates and install latest version')
  .action(async () => {
    console.log('Checking for updates...');
    // For V1, just print manual update instructions
    console.log('To update via npm:  npm update -g agent-bridge');
    console.log('To update via curl: curl -fsSL https://raw.githubusercontent.com/alexsanqp/agent-bridge/main/install/install.sh | bash');
    console.log('Current version: 0.1.0');
  });

program.parse();
