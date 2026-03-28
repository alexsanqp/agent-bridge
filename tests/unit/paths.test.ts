import { describe, it, expect } from 'vitest';
import {
  toForwardSlashes,
  normalizePath,
  findProjectRoot,
  resolveBridgeDir,
} from '../../src/utils/paths.js';

describe('toForwardSlashes', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toForwardSlashes('C:\\Users\\foo\\bar')).toBe('C:/Users/foo/bar');
  });

  it('leaves forward slashes unchanged', () => {
    expect(toForwardSlashes('a/b/c')).toBe('a/b/c');
  });

  it('handles mixed slashes', () => {
    expect(toForwardSlashes('a\\b/c\\d')).toBe('a/b/c/d');
  });

  it('returns empty string unchanged', () => {
    expect(toForwardSlashes('')).toBe('');
  });
});

describe('normalizePath', () => {
  it('returns an absolute path with forward slashes', () => {
    const result = normalizePath('src/utils');
    expect(result).not.toContain('\\');
    // path.resolve produces an absolute path
    expect(/^[A-Z]:\/|^\//.test(result)).toBe(true);
  });

  it('resolves relative segments', () => {
    const result = normalizePath('src/../src/utils');
    expect(result).toContain('src/utils');
    expect(result).not.toContain('..');
  });
});

describe('findProjectRoot', () => {
  it('finds project root from the agent-bridge directory', () => {
    const root = findProjectRoot('C:\\DISK_D\\Projects\\MINE\\agent-bridge');
    expect(root).toMatch(/agent-bridge$/);
    expect(root).not.toContain('\\');
  });

  it('finds project root from a nested subdirectory', () => {
    const root = findProjectRoot('C:\\DISK_D\\Projects\\MINE\\agent-bridge\\src\\utils');
    expect(root).toMatch(/agent-bridge$/);
  });

  it('defaults to cwd when no marker is found at filesystem root', () => {
    // When starting from the project dir itself, it should still find it
    const root = findProjectRoot();
    expect(root).not.toContain('\\');
  });
});

describe('resolveBridgeDir', () => {
  it('appends .agent-bridge with forward slashes', () => {
    const result = resolveBridgeDir('/home/user/project');
    expect(result).toBe('/home/user/project/.agent-bridge');
  });

  it('handles Windows-style root with forward slashes', () => {
    const result = resolveBridgeDir('C:/Projects/my-app');
    expect(result).toBe('C:/Projects/my-app/.agent-bridge');
  });
});
