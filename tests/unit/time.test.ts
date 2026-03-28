import { describe, it, expect, vi, afterEach } from 'vitest';
import { now, expiresAt, isExpired } from '../../src/utils/time.js';

describe('now', () => {
  it('returns a valid ISO 8601 string', () => {
    const result = now();
    expect(() => new Date(result)).not.toThrow();
    // ISO strings end with 'Z'
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it('returns a timestamp close to the current time', () => {
    const before = Date.now();
    const result = new Date(now()).getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe('expiresAt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a future timestamp (default 30 minutes)', () => {
    vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00.000Z') });
    const result = expiresAt();
    expect(result).toBe('2026-01-15T12:30:00.000Z');
  });

  it('respects custom minutes', () => {
    vi.useFakeTimers({ now: new Date('2026-01-15T12:00:00.000Z') });
    const result = expiresAt(60);
    expect(result).toBe('2026-01-15T13:00:00.000Z');
  });

  it('returns a timestamp after now()', () => {
    const current = new Date(now()).getTime();
    const future = new Date(expiresAt(1)).getTime();
    expect(future).toBeGreaterThan(current);
  });
});

describe('isExpired', () => {
  it('returns false for null', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('returns true for a past date', () => {
    expect(isExpired('2000-01-01T00:00:00.000Z')).toBe(true);
  });

  it('returns false for a far future date', () => {
    expect(isExpired('2099-12-31T23:59:59.999Z')).toBe(false);
  });
});
