import path from 'node:path';
import picomatch from 'picomatch';

export interface PolicyConfig {
  blockedPatterns: string[];
  maxArtifactSizeKb: number;
}

export const DEFAULT_BLOCKED_PATTERNS: string[] = [
  '*.env',
  '*.env.*',
  '.env',
  '*.key',
  '*.pem',
  '*.p12',
  '*.pfx',
  '*.jks',
  'id_rsa*',
  'id_ed25519*',
  '*.credentials',
  '**/credentials.json',
  '**/.aws/credentials',
  '**/.ssh/*',
  '**/secrets.*',
  '**/.secret*',
];

export const DEFAULT_MAX_ARTIFACT_SIZE_KB = 1024;

export function isBlockedFile(
  filepath: string,
  blockedPatterns: string[] = DEFAULT_BLOCKED_PATTERNS,
): boolean {
  const normalized = filepath.replace(/\\/g, '/');
  const basename = path.basename(normalized);
  const matchers = blockedPatterns.map((pattern) => picomatch(pattern, { dot: true }));

  return matchers.some((match) => match(basename) || match(normalized));
}

export function validateArtifactSize(
  sizeBytes: number,
  maxSizeKb: number = DEFAULT_MAX_ARTIFACT_SIZE_KB,
): boolean {
  return sizeBytes <= maxSizeKb * 1024;
}

export function validatePathWithinProject(
  filepath: string,
  projectRoot: string,
): boolean {
  const resolvedPath = path.resolve(projectRoot, filepath).replace(/\\/g, '/');
  const resolvedRoot = path.resolve(projectRoot).replace(/\\/g, '/');

  return resolvedPath.startsWith(resolvedRoot + '/') || resolvedPath === resolvedRoot;
}
