import { describe, it, expect } from 'vitest';
import { BridgeError, BridgeErrorCode } from '../../src/domain/errors.js';

describe('BridgeError', () => {
  it('extends Error', () => {
    const err = new BridgeError(BridgeErrorCode.UNKNOWN_AGENT, 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct name property', () => {
    const err = new BridgeError(BridgeErrorCode.UNKNOWN_AGENT, 'test');
    expect(err.name).toBe('BridgeError');
  });

  it('stores code correctly', () => {
    const err = new BridgeError(BridgeErrorCode.TASK_NOT_FOUND, 'not found');
    expect(err.code).toBe(BridgeErrorCode.TASK_NOT_FOUND);
  });

  it('stores message correctly', () => {
    const err = new BridgeError(BridgeErrorCode.DB_ERROR, 'database failed');
    expect(err.message).toBe('database failed');
  });

  it('stores details when provided', () => {
    const details = { taskId: '123', field: 'status' };
    const err = new BridgeError(BridgeErrorCode.INVALID_TRANSITION, 'bad transition', details);
    expect(err.details).toEqual(details);
  });

  it('details are undefined when not provided', () => {
    const err = new BridgeError(BridgeErrorCode.FILE_NOT_FOUND, 'missing');
    expect(err.details).toBeUndefined();
  });

  it('all BridgeErrorCode enum values exist (10 values)', () => {
    const codes = Object.values(BridgeErrorCode);
    expect(codes).toHaveLength(10);
    expect(codes).toContain('UNKNOWN_AGENT');
    expect(codes).toContain('BLOCKED_FILE');
    expect(codes).toContain('FILE_TOO_LARGE');
    expect(codes).toContain('FILE_NOT_FOUND');
    expect(codes).toContain('TASK_NOT_FOUND');
    expect(codes).toContain('NOT_RECEIVER');
    expect(codes).toContain('NOT_PARTICIPANT');
    expect(codes).toContain('TASK_CLOSED');
    expect(codes).toContain('INVALID_TRANSITION');
    expect(codes).toContain('DB_ERROR');
  });

  it('is catchable as Error', () => {
    let caught: Error | null = null;

    try {
      throw new BridgeError(BridgeErrorCode.BLOCKED_FILE, 'blocked');
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toBe('blocked');
  });

  it('instanceof checks work', () => {
    const err = new BridgeError(BridgeErrorCode.FILE_TOO_LARGE, 'too big');
    expect(err instanceof BridgeError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
