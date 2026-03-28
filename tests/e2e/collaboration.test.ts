import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask, getTask, getTasksByReceiver, updateTaskStatus } from '../../src/store/tasks.js';
import { createMessage, getMessagesByTask, getNewMessages, getMessageCount } from '../../src/store/messages.js';
import { upsertAgent } from '../../src/store/agents.js';
import { TaskType, TaskStatus } from '../../src/domain/models.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-collab-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('agent collaboration e2e (m-14)', () => {
  describe('scenario 1: two-agent review flow', () => {
    it('Agent A sends task, Agent B receives, replies, Agent A completes', async () => {
      // 1. Setup agents
      upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'claude' });
      upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'cursor' });

      // 2. Agent A sends task to agent-b with a request message
      const task = createTask(db, {
        task_type: TaskType.Review,
        sender: 'agent-a',
        receiver: 'agent-b',
        summary: 'Review auth module changes',
      });

      const requestMsg = createMessage(db, {
        task_id: task.id,
        author: 'agent-a',
        kind: 'request',
        content: 'Please review the auth module refactor in src/auth/',
      });

      // 3. Agent B checks inbox -> sees 1 pending task
      const inbox = getTasksByReceiver(db, 'agent-b', TaskStatus.Pending);
      expect(inbox).toHaveLength(1);
      expect(inbox[0].id).toBe(task.id);

      // 4. Agent B reads task -> transitions to active
      const activeTask = updateTaskStatus(db, task.id, TaskStatus.Active);
      expect(activeTask.status).toBe(TaskStatus.Active);

      // 5. Agent B replies
      await new Promise((resolve) => setTimeout(resolve, 15));

      const replyMsg = createMessage(db, {
        task_id: task.id,
        author: 'agent-b',
        kind: 'reply',
        content: 'LGTM with minor suggestions: extract helper function in auth/utils.ts',
      });

      // 6. Agent A gets new messages after the request
      const newMessages = getNewMessages(db, task.id, requestMsg.created_at);
      expect(newMessages).toHaveLength(1);
      expect(newMessages[0].id).toBe(replyMsg.id);
      expect(newMessages[0].kind).toBe('reply');
      expect(newMessages[0].author).toBe('agent-b');

      // 7. Agent A completes task
      const completedTask = updateTaskStatus(db, task.id, TaskStatus.Completed);

      // 8. Verify final state
      expect(completedTask.status).toBe(TaskStatus.Completed);
      expect(getMessageCount(db, task.id)).toBe(2);

      const finalTask = getTask(db, task.id);
      expect(finalTask).not.toBeNull();
      expect(finalTask!.status).toBe(TaskStatus.Completed);
    });
  });

  describe('scenario 2: three-agent collaboration', () => {
    it('Agent A -> B -> C chain with cascading tasks', async () => {
      // Setup agents
      upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'claude' });
      upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'cursor' });
      upsertAgent(db, { name: 'agent-c', role: 'tester', client: 'windsurf' });

      // 1. Agent A sends review task to Agent B
      const reviewTask = createTask(db, {
        task_type: TaskType.Review,
        sender: 'agent-a',
        receiver: 'agent-b',
        summary: 'Review payment module',
      });

      createMessage(db, {
        task_id: reviewTask.id,
        author: 'agent-a',
        kind: 'request',
        content: 'Please review the payment module changes',
      });

      updateTaskStatus(db, reviewTask.id, TaskStatus.Active);

      // 2. Agent B reviews, then sends test task to Agent C
      const testTask = createTask(db, {
        task_type: TaskType.Test,
        sender: 'agent-b',
        receiver: 'agent-c',
        summary: 'Write tests for payment module',
      });

      createMessage(db, {
        task_id: testTask.id,
        author: 'agent-b',
        kind: 'request',
        content: 'Write integration tests for the payment flow',
      });

      // Agent B waits for Agent C's reply
      updateTaskStatus(db, reviewTask.id, TaskStatus.WaitingReply);
      updateTaskStatus(db, testTask.id, TaskStatus.Active);

      // 3. Agent C writes tests and replies to Agent B
      await new Promise((resolve) => setTimeout(resolve, 15));

      createMessage(db, {
        task_id: testTask.id,
        author: 'agent-c',
        kind: 'reply',
        content: 'Tests written: 5 passing, 0 failing. Coverage at 92%.',
      });

      updateTaskStatus(db, testTask.id, TaskStatus.Completed);

      // 4. Agent B replies to Agent A with consolidated result
      updateTaskStatus(db, reviewTask.id, TaskStatus.Active);

      await new Promise((resolve) => setTimeout(resolve, 15));

      createMessage(db, {
        task_id: reviewTask.id,
        author: 'agent-b',
        kind: 'reply',
        content: 'Review complete. Tests pass (92% coverage). Approved.',
      });

      // 5. Agent A completes original task
      updateTaskStatus(db, reviewTask.id, TaskStatus.Completed);

      // 6. Verify both tasks completed with correct message chains
      const finalReviewTask = getTask(db, reviewTask.id);
      const finalTestTask = getTask(db, testTask.id);

      expect(finalReviewTask!.status).toBe(TaskStatus.Completed);
      expect(finalTestTask!.status).toBe(TaskStatus.Completed);

      const reviewMessages = getMessagesByTask(db, reviewTask.id);
      const testMessages = getMessagesByTask(db, testTask.id);

      expect(reviewMessages).toHaveLength(2);
      expect(reviewMessages[0].author).toBe('agent-a');
      expect(reviewMessages[0].kind).toBe('request');
      expect(reviewMessages[1].author).toBe('agent-b');
      expect(reviewMessages[1].kind).toBe('reply');

      expect(testMessages).toHaveLength(2);
      expect(testMessages[0].author).toBe('agent-b');
      expect(testMessages[0].kind).toBe('request');
      expect(testMessages[1].author).toBe('agent-c');
      expect(testMessages[1].kind).toBe('reply');
    });
  });

  describe('scenario 3: task expiration', () => {
    it('expired task is detected via lazy expiration on inbox check', () => {
      upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'claude' });
      upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'cursor' });

      // 1. Create task with expires_at in the past
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const task = createTask(db, {
        task_type: TaskType.Review,
        sender: 'agent-a',
        receiver: 'agent-b',
        summary: 'Urgent review - already expired',
        expires_at: pastDate,
      });

      createMessage(db, {
        task_id: task.id,
        author: 'agent-a',
        kind: 'request',
        content: 'Please review ASAP',
      });

      // 2. Agent B checks inbox - lazy expiration triggers
      const pendingTasks = getTasksByReceiver(db, 'agent-b', TaskStatus.Pending);
      expect(pendingTasks).toHaveLength(0);

      // 3. Verify status is expired
      const expiredTask = getTask(db, task.id);
      expect(expiredTask).not.toBeNull();
      expect(expiredTask!.status).toBe(TaskStatus.Expired);
    });
  });

  describe('scenario 4: task cancellation mid-flow', () => {
    it('Agent A cancels task while Agent B is working', () => {
      upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'claude' });
      upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'cursor' });

      // 1. Agent A sends task
      const task = createTask(db, {
        task_type: TaskType.Review,
        sender: 'agent-a',
        receiver: 'agent-b',
        summary: 'Review API endpoints',
      });

      createMessage(db, {
        task_id: task.id,
        author: 'agent-a',
        kind: 'request',
        content: 'Review the new REST endpoints in src/api/',
      });

      // 2. Agent B starts working (task becomes active)
      updateTaskStatus(db, task.id, TaskStatus.Active);

      const activeTask = getTask(db, task.id);
      expect(activeTask!.status).toBe(TaskStatus.Active);

      // 3. Agent A cancels the task and leaves a note
      updateTaskStatus(db, task.id, TaskStatus.Cancelled);

      createMessage(db, {
        task_id: task.id,
        author: 'agent-a',
        kind: 'note',
        content: 'Cancelled: requirements changed, endpoints redesigned',
      });

      // 4. Verify final state
      const cancelledTask = getTask(db, task.id);
      expect(cancelledTask).not.toBeNull();
      expect(cancelledTask!.status).toBe(TaskStatus.Cancelled);

      const messages = getMessagesByTask(db, task.id);
      expect(messages).toHaveLength(2);

      const cancellationNote = messages.find((m) => m.kind === 'note');
      expect(cancellationNote).toBeDefined();
      expect(cancellationNote!.author).toBe('agent-a');
      expect(cancellationNote!.content).toContain('Cancelled');
    });
  });
});
