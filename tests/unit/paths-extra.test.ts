import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureDir } from '../../src/utils/paths.js';

let tmpDir: string;

function makeTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-paths-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('ensureDir', () => {
  it('creates a directory that does not exist', () => {
    const root = makeTmp();
    const target = path.join(root, 'new-dir');

    expect(fs.existsSync(target)).toBe(false);
    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('is idempotent — calling twice on same path does not throw', () => {
    const root = makeTmp();
    const target = path.join(root, 'idem');

    ensureDir(target);
    expect(() => ensureDir(target)).not.toThrow();
    expect(fs.existsSync(target)).toBe(true);
  });

  it('creates nested directories recursively', () => {
    const root = makeTmp();
    const target = path.join(root, 'a', 'b', 'c');

    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('works on an already existing directory', () => {
    const root = makeTmp();
    const target = path.join(root, 'existing');
    fs.mkdirSync(target);

    expect(() => ensureDir(target)).not.toThrow();
    expect(fs.existsSync(target)).toBe(true);
  });

  it('created directory is actually a directory', () => {
    const root = makeTmp();
    const target = path.join(root, 'check-stat');

    ensureDir(target);
    const stat = fs.statSync(target);
    expect(stat.isDirectory()).toBe(true);
  });
});
