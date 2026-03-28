import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, resolveBridgeDir } from '../utils/paths.js';
import { openDatabase, closeDatabase } from '../store/database.js';
import { cleanupTasks } from '../store/tasks.js';

export async function runReset(opts: { hard?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  const bridgeDir = resolveBridgeDir(projectRoot);
  const db = openDatabase(bridgeDir);

  try {
    const beforeCount = (
      db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }
    ).count;

    cleanupTasks(db, opts.hard ?? false);

    const afterCount = (
      db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }
    ).count;

    const deleted = beforeCount - afterCount;

    if (opts.hard) {
      console.log(`Hard reset: removed all ${deleted} task(s), messages, and artifacts from DB.`);

      const artifactsDir = path.join(bridgeDir, 'artifacts');
      if (fs.existsSync(artifactsDir)) {
        fs.rmSync(artifactsDir, { recursive: true, force: true });
        console.log('Deleted artifacts directory.');
      }
    } else {
      console.log(`Soft reset: cleaned up ${deleted} expired/cancelled task(s).`);
    }
  } finally {
    closeDatabase(db);
  }
}
