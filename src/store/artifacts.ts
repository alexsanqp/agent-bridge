import type BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Artifact, CreateArtifactInput } from '../domain/models.js';
import { BridgeError, BridgeErrorCode } from '../domain/errors.js';
import { isBlockedFile, validateArtifactSize, validatePathWithinProject } from '../domain/policies.js';
import type { PolicyConfig } from '../domain/policies.js';
import { generateId } from '../utils/ids.js';
import { now } from '../utils/time.js';
import { ensureDir, toForwardSlashes } from '../utils/paths.js';

function computeChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function copyArtifact(
  db: BetterSqlite3.Database,
  sourcePath: string,
  taskId: string,
  messageId: string,
  bridgeDir: string,
  projectRoot: string,
  policies?: Partial<PolicyConfig>,
): Artifact {
  const resolvedSource = path.resolve(projectRoot, sourcePath);

  if (!fs.existsSync(resolvedSource)) {
    throw new BridgeError(BridgeErrorCode.FILE_NOT_FOUND, `File not found: ${sourcePath}`);
  }

  if (!validatePathWithinProject(resolvedSource, projectRoot)) {
    throw new BridgeError(
      BridgeErrorCode.BLOCKED_FILE,
      `Path escapes project root: ${sourcePath}`,
    );
  }

  if (isBlockedFile(resolvedSource, policies?.blockedPatterns)) {
    throw new BridgeError(BridgeErrorCode.BLOCKED_FILE, `Blocked file pattern: ${sourcePath}`);
  }

  const stats = fs.statSync(resolvedSource);

  if (!validateArtifactSize(stats.size, policies?.maxArtifactSizeKb)) {
    throw new BridgeError(
      BridgeErrorCode.FILE_TOO_LARGE,
      `File exceeds max artifact size: ${sourcePath} (${stats.size} bytes)`,
    );
  }

  const checksum = computeChecksum(resolvedSource);
  const filename = path.basename(resolvedSource);
  const id = generateId();
  const targetDir = path.join(bridgeDir, 'artifacts', taskId);
  ensureDir(targetDir);

  const targetFilename = `${id}-${filename}`;
  const targetPath = path.join(targetDir, targetFilename);
  fs.copyFileSync(resolvedSource, targetPath);

  const relativePath = toForwardSlashes(path.relative(bridgeDir, targetPath));
  const ext = path.extname(filename).replace(/^\./, '') || 'unknown';
  const createdAt = now();

  const artifact: Artifact = {
    id,
    task_id: taskId,
    message_id: messageId,
    filename,
    type: ext,
    size: stats.size,
    checksum,
    path: relativePath,
    created_at: createdAt,
  };

  db.prepare(
    `INSERT INTO artifacts (id, task_id, message_id, filename, type, size, checksum, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    artifact.id,
    artifact.task_id,
    artifact.message_id,
    artifact.filename,
    artifact.type,
    artifact.size,
    artifact.checksum,
    artifact.path,
    artifact.created_at,
  );

  return artifact;
}

export function getArtifactsByTask(
  db: BetterSqlite3.Database,
  taskId: string,
): Artifact[] {
  return db
    .prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as Artifact[];
}

export function getArtifactsByMessage(
  db: BetterSqlite3.Database,
  messageId: string,
): Artifact[] {
  return db
    .prepare('SELECT * FROM artifacts WHERE message_id = ?')
    .all(messageId) as Artifact[];
}
