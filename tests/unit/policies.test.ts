import { describe, it, expect } from 'vitest';
import {
  isBlockedFile,
  validateArtifactSize,
  validatePathWithinProject,
  DEFAULT_BLOCKED_PATTERNS,
  DEFAULT_MAX_ARTIFACT_SIZE_KB,
} from '../../src/domain/policies.js';

describe('isBlockedFile', () => {
  describe('blocks sensitive files with default patterns', () => {
    const blockedFiles = [
      '.env',
      '.env.local',
      'app.key',
      'cert.pem',
      'id_rsa',
      'credentials.json',
      '.aws/credentials',
      '.ssh/id_ed25519',
      'secrets.yaml',
      '.secretfile',
    ];

    for (const file of blockedFiles) {
      it(`blocks "${file}"`, () => {
        expect(isBlockedFile(file)).toBe(true);
      });
    }
  });

  describe('allows normal files', () => {
    const allowedFiles = ['index.ts', 'README.md', 'app.config.js'];

    for (const file of allowedFiles) {
      it(`allows "${file}"`, () => {
        expect(isBlockedFile(file)).toBe(false);
      });
    }
  });

  describe('custom patterns', () => {
    it('blocks files matching custom patterns', () => {
      expect(isBlockedFile('backup.sql', ['*.sql'])).toBe(true);
    });

    it('allows files not matching custom patterns', () => {
      expect(isBlockedFile('.env', ['*.sql'])).toBe(false);
    });
  });
});

describe('validateArtifactSize', () => {
  it('accepts zero bytes', () => {
    expect(validateArtifactSize(0)).toBe(true);
  });

  it('accepts size exactly at the default limit', () => {
    expect(validateArtifactSize(DEFAULT_MAX_ARTIFACT_SIZE_KB * 1024)).toBe(true);
  });

  it('rejects size one byte over the default limit', () => {
    expect(validateArtifactSize(DEFAULT_MAX_ARTIFACT_SIZE_KB * 1024 + 1)).toBe(false);
  });

  it('respects a custom limit', () => {
    const customLimitKb = 512;
    expect(validateArtifactSize(512 * 1024, customLimitKb)).toBe(true);
    expect(validateArtifactSize(512 * 1024 + 1, customLimitKb)).toBe(false);
  });
});

describe('validatePathWithinProject', () => {
  const projectRoot = '/home/user/project';

  it('accepts a normal relative path', () => {
    expect(validatePathWithinProject('src/index.ts', projectRoot)).toBe(true);
  });

  it('accepts a nested relative path', () => {
    expect(validatePathWithinProject('src/utils/helpers.ts', projectRoot)).toBe(true);
  });

  it('rejects a path that escapes the project root', () => {
    expect(validatePathWithinProject('../../etc/passwd', projectRoot)).toBe(false);
  });

  it('rejects an absolute path outside the project', () => {
    expect(validatePathWithinProject('/etc/passwd', projectRoot)).toBe(false);
  });

  it('accepts an absolute path within the project', () => {
    expect(validatePathWithinProject('/home/user/project/src/main.ts', projectRoot)).toBe(true);
  });

  it('rejects a path that is a sibling with a matching prefix', () => {
    expect(validatePathWithinProject('../project-other/file.ts', projectRoot)).toBe(false);
  });
});
