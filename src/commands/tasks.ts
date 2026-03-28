import { findProjectRoot, resolveBridgeDir } from '../utils/paths.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { getActiveTasks, getTask } from '../store/tasks.js';
import { getTasksByReceiver } from '../store/tasks.js';
import type { Task } from '../domain/models.js';
import { TaskStatus } from '../domain/models.js';

export async function runTasks(opts: { status?: string; agent?: string }): Promise<void> {
  const projectRoot = findProjectRoot();
  const bridgeDir = resolveBridgeDir(projectRoot);
  const db = openDatabase(bridgeDir);

  try {
    let tasks: Task[];

    if (opts.agent && opts.status) {
      tasks = getTasksByReceiver(db, opts.agent, opts.status as TaskStatus);
    } else if (opts.agent) {
      tasks = getTasksByReceiver(db, opts.agent);
    } else if (opts.status) {
      tasks = db
        .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC')
        .all(opts.status) as Task[];
    } else {
      tasks = getActiveTasks(db);
    }

    // Apply lazy expiration to all tasks
    tasks = tasks
      .map((t) => getTask(db, t.id))
      .filter((t): t is Task => t !== null);

    if (tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }

    const header = `${'ID'.padEnd(12)} ${'Type'.padEnd(12)} ${'Sender'.padEnd(14)} ${'Receiver'.padEnd(14)} ${'Status'.padEnd(14)} Summary`;
    console.log(header);
    console.log('-'.repeat(header.length + 20));

    for (const task of tasks) {
      const id = task.id.substring(0, 10);
      console.log(
        `${id.padEnd(12)} ${task.task_type.padEnd(12)} ${task.sender.padEnd(14)} ${task.receiver.padEnd(14)} ${task.status.padEnd(14)} ${task.summary}`,
      );
    }

    console.log();
    console.log(`Total: ${tasks.length} task(s)`);
  } finally {
    closeDatabase(db);
  }
}
