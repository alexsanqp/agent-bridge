import { describe, it, expect } from 'vitest';
import { validateTransition, getValidTransitions, isTerminal } from '../../src/domain/status.js';
import { TaskStatus } from '../../src/domain/models.js';

describe('validateTransition', () => {
  describe('valid transitions from Pending', () => {
    it.each([TaskStatus.Active, TaskStatus.Cancelled, TaskStatus.Expired])(
      'allows pending → %s',
      (to) => {
        expect(validateTransition(TaskStatus.Pending, to)).toBe(true);
      },
    );
  });

  describe('valid transitions from Active', () => {
    it.each([
      TaskStatus.WaitingReply,
      TaskStatus.Completed,
      TaskStatus.Failed,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ])('allows active → %s', (to) => {
      expect(validateTransition(TaskStatus.Active, to)).toBe(true);
    });
  });

  describe('valid transitions from WaitingReply', () => {
    it.each([
      TaskStatus.Active,
      TaskStatus.Completed,
      TaskStatus.Failed,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ])('allows waiting_reply → %s', (to) => {
      expect(validateTransition(TaskStatus.WaitingReply, to)).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    it('rejects pending → completed', () => {
      expect(validateTransition(TaskStatus.Pending, TaskStatus.Completed)).toBe(false);
    });

    it('rejects pending → failed', () => {
      expect(validateTransition(TaskStatus.Pending, TaskStatus.Failed)).toBe(false);
    });

    it('rejects pending → waiting_reply', () => {
      expect(validateTransition(TaskStatus.Pending, TaskStatus.WaitingReply)).toBe(false);
    });

    it('rejects pending → pending (self-transition)', () => {
      expect(validateTransition(TaskStatus.Pending, TaskStatus.Pending)).toBe(false);
    });

    it('rejects active → pending', () => {
      expect(validateTransition(TaskStatus.Active, TaskStatus.Pending)).toBe(false);
    });

    it('rejects active → active (self-transition)', () => {
      expect(validateTransition(TaskStatus.Active, TaskStatus.Active)).toBe(false);
    });
  });

  describe('terminal states cannot transition anywhere', () => {
    const terminalStatuses = [
      TaskStatus.Completed,
      TaskStatus.Failed,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ];

    const allStatuses = Object.values(TaskStatus);

    for (const terminal of terminalStatuses) {
      describe(`from ${terminal}`, () => {
        it.each(allStatuses)(`rejects ${terminal} → %s`, (to) => {
          expect(validateTransition(terminal, to)).toBe(false);
        });
      });
    }
  });
});

describe('getValidTransitions', () => {
  it('returns [active, cancelled, expired] for Pending', () => {
    expect(getValidTransitions(TaskStatus.Pending)).toEqual([
      TaskStatus.Active,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ]);
  });

  it('returns [waiting_reply, completed, failed, cancelled, expired] for Active', () => {
    expect(getValidTransitions(TaskStatus.Active)).toEqual([
      TaskStatus.WaitingReply,
      TaskStatus.Completed,
      TaskStatus.Failed,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ]);
  });

  it('returns [active, completed, failed, cancelled, expired] for WaitingReply', () => {
    expect(getValidTransitions(TaskStatus.WaitingReply)).toEqual([
      TaskStatus.Active,
      TaskStatus.Completed,
      TaskStatus.Failed,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ]);
  });

  it('returns empty array for Completed', () => {
    expect(getValidTransitions(TaskStatus.Completed)).toEqual([]);
  });

  it('returns empty array for Failed', () => {
    expect(getValidTransitions(TaskStatus.Failed)).toEqual([]);
  });

  it('returns empty array for Cancelled', () => {
    expect(getValidTransitions(TaskStatus.Cancelled)).toEqual([]);
  });

  it('returns empty array for Expired', () => {
    expect(getValidTransitions(TaskStatus.Expired)).toEqual([]);
  });
});

describe('isTerminal', () => {
  describe('terminal statuses', () => {
    it.each([
      TaskStatus.Completed,
      TaskStatus.Failed,
      TaskStatus.Cancelled,
      TaskStatus.Expired,
    ])('%s is terminal', (status) => {
      expect(isTerminal(status)).toBe(true);
    });
  });

  describe('non-terminal statuses', () => {
    it.each([TaskStatus.Pending, TaskStatus.Active, TaskStatus.WaitingReply])(
      '%s is NOT terminal',
      (status) => {
        expect(isTerminal(status)).toBe(false);
      },
    );
  });
});
