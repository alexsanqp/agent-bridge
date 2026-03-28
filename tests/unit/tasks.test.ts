import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  TaskType,
  type MessageKind,
  type CreateTaskInput,
  type Task,
} from '../../src/domain/models.js';
import { validateTransition } from '../../src/domain/status.js';
import { isExpired, expiresAt } from '../../src/utils/time.js';

describe('TaskType enum', () => {
  it('contains all spec-defined values', () => {
    expect(TaskType.Review).toBe('review');
    expect(TaskType.Debug).toBe('debug');
    expect(TaskType.Test).toBe('test');
    expect(TaskType.Question).toBe('question');
    expect(TaskType.Implement).toBe('implement');
  });

  it('has exactly 5 members', () => {
    expect(Object.values(TaskType)).toHaveLength(5);
  });
});

describe('TaskStatus enum', () => {
  it('contains all 7 spec-defined values', () => {
    expect(TaskStatus.Pending).toBe('pending');
    expect(TaskStatus.Active).toBe('active');
    expect(TaskStatus.WaitingReply).toBe('waiting_reply');
    expect(TaskStatus.Completed).toBe('completed');
    expect(TaskStatus.Failed).toBe('failed');
    expect(TaskStatus.Cancelled).toBe('cancelled');
    expect(TaskStatus.Expired).toBe('expired');
  });

  it('has exactly 7 members', () => {
    expect(Object.values(TaskStatus)).toHaveLength(7);
  });
});

describe('MessageKind type', () => {
  it('accepts request, reply, and note', () => {
    const kinds: MessageKind[] = ['request', 'reply', 'note'];
    expect(kinds).toEqual(['request', 'reply', 'note']);
  });
});

describe('CreateTaskInput interface', () => {
  it('accepts a valid input with all required fields', () => {
    const input: CreateTaskInput = {
      task_type: TaskType.Review,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Review the auth module',
    };

    expect(input.task_type).toBe(TaskType.Review);
    expect(input.sender).toBe('cursor-dev');
    expect(input.receiver).toBe('claude-reviewer');
    expect(input.summary).toBe('Review the auth module');
    expect(input.expires_at).toBeUndefined();
  });

  it('accepts optional expires_at field', () => {
    const input: CreateTaskInput = {
      task_type: TaskType.Implement,
      sender: 'architect',
      receiver: 'cursor-dev',
      summary: 'Implement caching layer',
      expires_at: '2026-12-31T23:59:59.000Z',
    };

    expect(input.expires_at).toBe('2026-12-31T23:59:59.000Z');
  });

  it('accepts null for expires_at', () => {
    const input: CreateTaskInput = {
      task_type: TaskType.Question,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Architecture question',
      expires_at: null,
    };

    expect(input.expires_at).toBeNull();
  });
});

describe('isExpired', () => {
  it('returns false when expires_at is null', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('returns true when expires_at is in the past', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    expect(isExpired(pastDate)).toBe(true);
  });

  it('returns false when expires_at is in the future', () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    expect(isExpired(futureDate)).toBe(false);
  });

  it('returns true for a date far in the past', () => {
    expect(isExpired('2000-01-01T00:00:00.000Z')).toBe(true);
  });

  it('returns false for a date far in the future', () => {
    expect(isExpired('2099-12-31T23:59:59.000Z')).toBe(false);
  });
});

describe('expiresAt', () => {
  it('defaults to 30 minutes in the future', () => {
    const before = Date.now();
    const result = new Date(expiresAt()).getTime();
    const after = Date.now();

    const expectedMin = before + 30 * 60 * 1000;
    const expectedMax = after + 30 * 60 * 1000;

    expect(result).toBeGreaterThanOrEqual(expectedMin);
    expect(result).toBeLessThanOrEqual(expectedMax);
  });

  it('accepts custom minutes', () => {
    const before = Date.now();
    const result = new Date(expiresAt(60)).getTime();
    const after = Date.now();

    const expectedMin = before + 60 * 60 * 1000;
    const expectedMax = after + 60 * 60 * 1000;

    expect(result).toBeGreaterThanOrEqual(expectedMin);
    expect(result).toBeLessThanOrEqual(expectedMax);
  });

  it('returns a valid ISO 8601 string', () => {
    const result = expiresAt();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});

describe('validateTransition — task lifecycle scenarios', () => {
  describe('new task flow: pending → active → waiting_reply → active → completed', () => {
    it('allows pending → active', () => {
      expect(validateTransition(TaskStatus.Pending, TaskStatus.Active)).toBe(true);
    });

    it('allows active → waiting_reply', () => {
      expect(validateTransition(TaskStatus.Active, TaskStatus.WaitingReply)).toBe(true);
    });

    it('allows waiting_reply → active', () => {
      expect(validateTransition(TaskStatus.WaitingReply, TaskStatus.Active)).toBe(true);
    });

    it('allows active → completed', () => {
      expect(validateTransition(TaskStatus.Active, TaskStatus.Completed)).toBe(true);
    });

    it('rejects further transitions from completed', () => {
      expect(validateTransition(TaskStatus.Completed, TaskStatus.Active)).toBe(false);
      expect(validateTransition(TaskStatus.Completed, TaskStatus.Pending)).toBe(false);
    });
  });

  describe('cancel flow: pending → cancelled', () => {
    it('allows pending → cancelled', () => {
      expect(validateTransition(TaskStatus.Pending, TaskStatus.Cancelled)).toBe(true);
    });

    it('rejects further transitions from cancelled', () => {
      expect(validateTransition(TaskStatus.Cancelled, TaskStatus.Pending)).toBe(false);
      expect(validateTransition(TaskStatus.Cancelled, TaskStatus.Active)).toBe(false);
    });
  });

  describe('expiration flow: active → expired', () => {
    it('allows active → expired', () => {
      expect(validateTransition(TaskStatus.Active, TaskStatus.Expired)).toBe(true);
    });

    it('rejects further transitions from expired', () => {
      expect(validateTransition(TaskStatus.Expired, TaskStatus.Active)).toBe(false);
      expect(validateTransition(TaskStatus.Expired, TaskStatus.Pending)).toBe(false);
    });
  });
});
