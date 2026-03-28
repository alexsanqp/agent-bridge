import path from 'node:path';
import fs from 'node:fs';

const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];

export function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

export function normalizePath(p: string): string {
  return toForwardSlashes(path.resolve(p));
}

export function findProjectRoot(startDir?: string): string {
  let dir = path.resolve(startDir ?? process.cwd());

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) {
        return toForwardSlashes(dir);
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return toForwardSlashes(path.resolve(startDir ?? process.cwd()));
    }
    dir = parent;
  }
}

export function resolveBridgeDir(projectRoot: string): string {
  return toForwardSlashes(path.join(projectRoot, '.agent-bridge'));
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
