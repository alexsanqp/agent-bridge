import { TaskStatus } from './models.js';

const TRANSITION_MAP: ReadonlyMap<TaskStatus, readonly TaskStatus[]> = new Map([
  [TaskStatus.Pending, [TaskStatus.Active, TaskStatus.Cancelled, TaskStatus.Expired]],
  [TaskStatus.Active, [TaskStatus.WaitingReply, TaskStatus.Completed, TaskStatus.Failed, TaskStatus.Cancelled, TaskStatus.Expired]],
  [TaskStatus.WaitingReply, [TaskStatus.Active, TaskStatus.Completed, TaskStatus.Failed, TaskStatus.Cancelled, TaskStatus.Expired]],
  [TaskStatus.Completed, []],
  [TaskStatus.Failed, []],
  [TaskStatus.Cancelled, []],
  [TaskStatus.Expired, []],
]);

export function validateTransition(from: TaskStatus, to: TaskStatus): boolean {
  return getValidTransitions(from).includes(to);
}

export function getValidTransitions(status: TaskStatus): readonly TaskStatus[] {
  return TRANSITION_MAP.get(status) ?? [];
}

export function isTerminal(status: TaskStatus): boolean {
  return getValidTransitions(status).length === 0;
}
