import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask, getTask, getTasksByReceiver, updateTaskStatus } from '../../src/store/tasks.js';
import { createMessage, getMessagesByTask, getNewMessages, getMessageCount } from '../../src/store/messages.js';
import { copyArtifact, getArtifactsByTask } from '../../src/store/artifacts.js';
import { upsertAgent } from '../../src/store/agents.js';
import { TaskType, TaskStatus } from '../../src/domain/models.js';
import type BetterSqlite3 from 'better-sqlite3';

describe('Scenario 2: Cursor asks Claude for review', () => {
  let tmpDir: string;
  let bridgeDir: string;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-s2-'));
    bridgeDir = path.join(tmpDir, '.agent-bridge');
    db = openDatabase(bridgeDir);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full spec flow: cursor-dev sends review to claude-reviewer with artifact', async () => {
    // 1. Setup: register agents
    upsertAgent(db, { name: 'cursor-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' });

    // 2. Create a real temp file as the artifact source
    const srcDir = path.join(tmpDir, 'src', 'auth');
    fs.mkdirSync(srcDir, { recursive: true });
    const artifactSourcePath = path.join(srcDir, 'index.ts');
    fs.writeFileSync(artifactSourcePath, `export function authenticate(token: string): boolean {
  // TODO: add input validation
  return verifyJWT(token);
}
`);

    // 3. cursor-dev: createTask
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Review auth module changes',
    });
    expect(task.status).toBe(TaskStatus.Pending);
    expect(task.sender).toBe('cursor-dev');
    expect(task.receiver).toBe('claude-reviewer');
    expect(task.task_type).toBe(TaskType.Review);
    expect(task.summary).toBe('Review auth module changes');

    // 4. cursor-dev: createMessage (request)
    const requestMsg = createMessage(db, {
      task_id: task.id,
      author: 'cursor-dev',
      kind: 'request',
      content: 'I refactored the auth module. Please review the changes in src/auth/index.ts.',
    });
    expect(requestMsg.kind).toBe('request');
    expect(requestMsg.author).toBe('cursor-dev');
    expect(requestMsg.task_id).toBe(task.id);

    // 5. cursor-dev: copyArtifact for src/auth/index.ts
    const artifact = copyArtifact(
      db,
      artifactSourcePath,
      task.id,
      requestMsg.id,
      bridgeDir,
      tmpDir,
    );
    expect(artifact.filename).toBe('index.ts');
    expect(artifact.type).toBe('ts');
    expect(artifact.task_id).toBe(task.id);
    expect(artifact.message_id).toBe(requestMsg.id);
    expect(artifact.size).toBeGreaterThan(0);
    expect(artifact.checksum).toBeTruthy();

    // 6. Verify: task status=pending, 1 message, 1 artifact
    const taskAfterSend = getTask(db, task.id);
    expect(taskAfterSend).not.toBeNull();
    expect(taskAfterSend!.status).toBe(TaskStatus.Pending);
    expect(getMessageCount(db, task.id)).toBe(1);
    const artifacts = getArtifactsByTask(db, task.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe(artifact.id);

    // 7. cursor-dev: simulate peer_wait by recording timestamp
    const waitTimestamp = requestMsg.created_at;

    // 8. claude-reviewer: getTasksByReceiver -> sees 1 pending task
    const inbox = getTasksByReceiver(db, 'claude-reviewer', TaskStatus.Pending);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].id).toBe(task.id);
    expect(inbox[0].summary).toBe('Review auth module changes');
    expect(inbox[0].sender).toBe('cursor-dev');
    expect(inbox[0].task_type).toBe(TaskType.Review);

    // 9. claude-reviewer: getTask -> verify task transitions to active
    updateTaskStatus(db, task.id, TaskStatus.Active);
    const activeTask = getTask(db, task.id);
    expect(activeTask).not.toBeNull();
    expect(activeTask!.status).toBe(TaskStatus.Active);

    // 10. claude-reviewer: createMessage (reply)
    await new Promise((resolve) => setTimeout(resolve, 15));

    const replyMsg = createMessage(db, {
      task_id: task.id,
      author: 'claude-reviewer',
      kind: 'reply',
      content: 'Found 3 issues: 1. Missing input validation for token parameter. 2. No error handling for expired tokens. 3. Missing rate limiting.',
    });
    expect(replyMsg.kind).toBe('reply');
    expect(replyMsg.author).toBe('claude-reviewer');

    // 11. Verify: getNewMessages from recorded timestamp returns the reply
    const newMessages = getNewMessages(db, task.id, waitTimestamp);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].id).toBe(replyMsg.id);
    expect(newMessages[0].kind).toBe('reply');
    expect(newMessages[0].author).toBe('claude-reviewer');
    expect(newMessages[0].content).toContain('Missing input validation');

    // 12. cursor-dev: updateTaskStatus to completed
    const completedTask = updateTaskStatus(db, task.id, TaskStatus.Completed);
    expect(completedTask.status).toBe(TaskStatus.Completed);

    // 13. Verify: final status is completed, message count is 2, artifact count is 1
    const finalTask = getTask(db, task.id);
    expect(finalTask).not.toBeNull();
    expect(finalTask!.status).toBe(TaskStatus.Completed);
    expect(getMessageCount(db, task.id)).toBe(2);
    expect(getArtifactsByTask(db, task.id)).toHaveLength(1);

    // Verify full message chain
    const allMessages = getMessagesByTask(db, task.id);
    expect(allMessages).toHaveLength(2);
    expect(allMessages[0].author).toBe('cursor-dev');
    expect(allMessages[0].kind).toBe('request');
    expect(allMessages[1].author).toBe('claude-reviewer');
    expect(allMessages[1].kind).toBe('reply');
  });
});

describe('Scenario 3: Three-way collaboration', () => {
  let tmpDir: string;
  let bridgeDir: string;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-s3-'));
    bridgeDir = path.join(tmpDir, '.agent-bridge');
    db = openDatabase(bridgeDir);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cursor-dev -> claude-reviewer -> codex-tester chain with cascading tasks', async () => {
    // Setup: 3 agents
    upsertAgent(db, { name: 'cursor-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' });
    upsertAgent(db, { name: 'codex-tester', role: 'tester', client: 'codex' });

    // 1. cursor-dev sends review task to claude-reviewer
    const reviewTask = createTask(db, {
      task_type: TaskType.Review,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Review auth module',
    });
    expect(reviewTask.status).toBe(TaskStatus.Pending);

    const cursorRequest = createMessage(db, {
      task_id: reviewTask.id,
      author: 'cursor-dev',
      kind: 'request',
      content: 'Review this auth module',
    });
    expect(cursorRequest.kind).toBe('request');

    // 2. claude-reviewer checks inbox -> sees task, gets it (->active)
    const reviewerInbox = getTasksByReceiver(db, 'claude-reviewer', TaskStatus.Pending);
    expect(reviewerInbox).toHaveLength(1);
    expect(reviewerInbox[0].id).toBe(reviewTask.id);

    updateTaskStatus(db, reviewTask.id, TaskStatus.Active);
    const activeReviewTask = getTask(db, reviewTask.id);
    expect(activeReviewTask!.status).toBe(TaskStatus.Active);

    // 3. claude-reviewer replies: "Looks good, needs tests"
    await new Promise((resolve) => setTimeout(resolve, 15));

    const reviewerReply1 = createMessage(db, {
      task_id: reviewTask.id,
      author: 'claude-reviewer',
      kind: 'reply',
      content: 'Looks good, needs tests',
    });
    expect(reviewerReply1.kind).toBe('reply');

    // 4. claude-reviewer creates NEW task to codex-tester
    const testTask = createTask(db, {
      task_type: TaskType.Test,
      sender: 'claude-reviewer',
      receiver: 'codex-tester',
      summary: 'Write tests for auth module',
    });
    expect(testTask.status).toBe(TaskStatus.Pending);
    expect(testTask.sender).toBe('claude-reviewer');
    expect(testTask.receiver).toBe('codex-tester');

    const testRequest = createMessage(db, {
      task_id: testTask.id,
      author: 'claude-reviewer',
      kind: 'request',
      content: 'Write unit tests for the auth module. Cover token validation and error handling.',
    });

    // claude-reviewer waits for codex
    updateTaskStatus(db, reviewTask.id, TaskStatus.WaitingReply);
    expect(getTask(db, reviewTask.id)!.status).toBe(TaskStatus.WaitingReply);

    // 5. codex-tester checks inbox -> sees task from claude-reviewer
    const codexInbox = getTasksByReceiver(db, 'codex-tester', TaskStatus.Pending);
    expect(codexInbox).toHaveLength(1);
    expect(codexInbox[0].id).toBe(testTask.id);
    expect(codexInbox[0].sender).toBe('claude-reviewer');
    expect(codexInbox[0].task_type).toBe(TaskType.Test);

    // 6. codex-tester gets task (->active), writes tests
    updateTaskStatus(db, testTask.id, TaskStatus.Active);
    expect(getTask(db, testTask.id)!.status).toBe(TaskStatus.Active);

    // 7. codex-tester replies with test results
    await new Promise((resolve) => setTimeout(resolve, 15));

    const codexReply = createMessage(db, {
      task_id: testTask.id,
      author: 'codex-tester',
      kind: 'reply',
      content: 'Tests written: 8 passing, 0 failing. Coverage 95%. All edge cases covered.',
    });
    expect(codexReply.author).toBe('codex-tester');

    // 8. claude-reviewer gets reply from codex, completes test task
    const codexNewMsgs = getNewMessages(db, testTask.id, testRequest.created_at);
    expect(codexNewMsgs).toHaveLength(1);
    expect(codexNewMsgs[0].id).toBe(codexReply.id);

    updateTaskStatus(db, testTask.id, TaskStatus.Completed);
    expect(getTask(db, testTask.id)!.status).toBe(TaskStatus.Completed);

    // 9. claude-reviewer replies to original cursor task: "Review passed, tests added"
    updateTaskStatus(db, reviewTask.id, TaskStatus.Active);

    await new Promise((resolve) => setTimeout(resolve, 15));

    const reviewerReply2 = createMessage(db, {
      task_id: reviewTask.id,
      author: 'claude-reviewer',
      kind: 'reply',
      content: 'Review passed, tests added by codex-tester. 8 tests passing with 95% coverage.',
    });

    // 10. cursor-dev gets reply, completes original task
    const cursorNewMsgs = getNewMessages(db, reviewTask.id, cursorRequest.created_at);
    expect(cursorNewMsgs.length).toBeGreaterThanOrEqual(2); // reviewerReply1 + reviewerReply2

    updateTaskStatus(db, reviewTask.id, TaskStatus.Completed);
    expect(getTask(db, reviewTask.id)!.status).toBe(TaskStatus.Completed);

    // 11. Verify: both tasks completed, correct message chains
    const finalReviewTask = getTask(db, reviewTask.id);
    const finalTestTask = getTask(db, testTask.id);
    expect(finalReviewTask!.status).toBe(TaskStatus.Completed);
    expect(finalTestTask!.status).toBe(TaskStatus.Completed);

    const reviewMessages = getMessagesByTask(db, reviewTask.id);
    expect(reviewMessages).toHaveLength(3);
    expect(reviewMessages[0].author).toBe('cursor-dev');
    expect(reviewMessages[0].kind).toBe('request');
    expect(reviewMessages[1].author).toBe('claude-reviewer');
    expect(reviewMessages[1].kind).toBe('reply');
    expect(reviewMessages[2].author).toBe('claude-reviewer');
    expect(reviewMessages[2].kind).toBe('reply');

    const testMessages = getMessagesByTask(db, testTask.id);
    expect(testMessages).toHaveLength(2);
    expect(testMessages[0].author).toBe('claude-reviewer');
    expect(testMessages[0].kind).toBe('request');
    expect(testMessages[1].author).toBe('codex-tester');
    expect(testMessages[1].kind).toBe('reply');

    // 12. Verify: all status transitions happened correctly
    expect(getMessageCount(db, reviewTask.id)).toBe(3);
    expect(getMessageCount(db, testTask.id)).toBe(2);
  });
});

describe('Scenario 4: Agent not running — delayed pickup', () => {
  let tmpDir: string;
  let bridgeDir: string;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-s4-'));
    bridgeDir = path.join(tmpDir, '.agent-bridge');
    db = openDatabase(bridgeDir);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('task persists while agent is offline and is picked up later', async () => {
    // Setup
    upsertAgent(db, { name: 'cursor-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' });

    // 1. cursor-dev sends task to claude-reviewer
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Review database migration scripts',
    });

    const requestMsg = createMessage(db, {
      task_id: task.id,
      author: 'cursor-dev',
      kind: 'request',
      content: 'Please review the migration scripts in db/migrations/',
    });

    // Record timestamp for later getNewMessages
    const waitTimestamp = requestMsg.created_at;

    // 2. Task sits in pending state
    const pendingTask = getTask(db, task.id);
    expect(pendingTask).not.toBeNull();
    expect(pendingTask!.status).toBe(TaskStatus.Pending);

    // 3. Simulate "10 minutes later" — no actual wait needed
    //    The task is durable in SQLite; no timeout unless expires_at is set.
    //    Verify it is still pending after no interaction.
    const stillPending = getTasksByReceiver(db, 'claude-reviewer', TaskStatus.Pending);
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].id).toBe(task.id);

    // 4. claude-reviewer checks inbox -> sees pending task (it's still there)
    const inbox = getTasksByReceiver(db, 'claude-reviewer', TaskStatus.Pending);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].id).toBe(task.id);
    expect(inbox[0].summary).toBe('Review database migration scripts');
    expect(inbox[0].sender).toBe('cursor-dev');

    // Verify messages are intact
    const messagesBeforePickup = getMessagesByTask(db, task.id);
    expect(messagesBeforePickup).toHaveLength(1);
    expect(messagesBeforePickup[0].content).toContain('migration scripts');

    // 5. claude-reviewer gets task -> active
    updateTaskStatus(db, task.id, TaskStatus.Active);
    const activeTask = getTask(db, task.id);
    expect(activeTask!.status).toBe(TaskStatus.Active);

    // 6. claude-reviewer replies
    await new Promise((resolve) => setTimeout(resolve, 15));

    const replyMsg = createMessage(db, {
      task_id: task.id,
      author: 'claude-reviewer',
      kind: 'reply',
      content: 'Migration scripts look good. Added index on users.email for performance.',
    });

    // 7. cursor-dev checks for new messages -> sees reply
    const newMessages = getNewMessages(db, task.id, waitTimestamp);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].id).toBe(replyMsg.id);
    expect(newMessages[0].author).toBe('claude-reviewer');
    expect(newMessages[0].kind).toBe('reply');

    // Complete task
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    // 8. Verify: entire flow works despite delay, all messages intact
    const finalTask = getTask(db, task.id);
    expect(finalTask!.status).toBe(TaskStatus.Completed);
    expect(getMessageCount(db, task.id)).toBe(2);

    const allMessages = getMessagesByTask(db, task.id);
    expect(allMessages).toHaveLength(2);
    expect(allMessages[0].author).toBe('cursor-dev');
    expect(allMessages[0].kind).toBe('request');
    expect(allMessages[1].author).toBe('claude-reviewer');
    expect(allMessages[1].kind).toBe('reply');
  });
});

describe('Scenario 5: Client closed mid-task — new connection picks up', () => {
  let tmpDir: string;
  let bridgeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-s5-'));
    bridgeDir = path.join(tmpDir, '.agent-bridge');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('data persists across DB connection lifecycle', async () => {
    // 1. Open DB connection 1 (simulates cursor's MCP process)
    const db1 = openDatabase(bridgeDir);

    upsertAgent(db1, { name: 'cursor-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db1, { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' });

    // 2. cursor-dev sends task, task is pending
    const task = createTask(db1, {
      task_type: TaskType.Review,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Review session persistence handling',
    });
    expect(task.status).toBe(TaskStatus.Pending);

    const requestMsg = createMessage(db1, {
      task_id: task.id,
      author: 'cursor-dev',
      kind: 'request',
      content: 'Review the session persistence layer for data loss edge cases.',
    });

    const taskId = task.id;
    const requestTimestamp = requestMsg.created_at;

    // Verify task is pending in connection 1
    expect(getTask(db1, taskId)!.status).toBe(TaskStatus.Pending);
    expect(getMessageCount(db1, taskId)).toBe(1);

    // 3. Close DB connection 1 (simulates cursor closing)
    closeDatabase(db1);

    // 4. Open DB connection 2 (simulates a different process, e.g., claude-reviewer's MCP)
    const db2 = openDatabase(bridgeDir);

    // 5. claude-reviewer (using connection 2): gets task, replies
    const inboxConn2 = getTasksByReceiver(db2, 'claude-reviewer', TaskStatus.Pending);
    expect(inboxConn2).toHaveLength(1);
    expect(inboxConn2[0].id).toBe(taskId);
    expect(inboxConn2[0].summary).toBe('Review session persistence handling');

    updateTaskStatus(db2, taskId, TaskStatus.Active);
    expect(getTask(db2, taskId)!.status).toBe(TaskStatus.Active);

    await new Promise((resolve) => setTimeout(resolve, 15));

    const replyMsg = createMessage(db2, {
      task_id: taskId,
      author: 'claude-reviewer',
      kind: 'reply',
      content: 'Found potential data loss on abrupt close. Recommend WAL checkpoint before shutdown.',
    });

    // Close connection 2
    closeDatabase(db2);

    // 6. Open DB connection 3 (simulates cursor's new MCP process)
    const db3 = openDatabase(bridgeDir);

    // 7. cursor-dev (connection 3): getTask -> sees claude's reply
    const taskConn3 = getTask(db3, taskId);
    expect(taskConn3).not.toBeNull();
    expect(taskConn3!.status).toBe(TaskStatus.Active);

    const newMessages = getNewMessages(db3, taskId, requestTimestamp);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].id).toBe(replyMsg.id);
    expect(newMessages[0].author).toBe('claude-reviewer');
    expect(newMessages[0].content).toContain('WAL checkpoint');

    // Verify all messages are intact
    const allMessages = getMessagesByTask(db3, taskId);
    expect(allMessages).toHaveLength(2);
    expect(allMessages[0].author).toBe('cursor-dev');
    expect(allMessages[0].kind).toBe('request');
    expect(allMessages[1].author).toBe('claude-reviewer');
    expect(allMessages[1].kind).toBe('reply');

    // 8. cursor-dev: completes task
    updateTaskStatus(db3, taskId, TaskStatus.Completed);
    const finalTask = getTask(db3, taskId);
    expect(finalTask!.status).toBe(TaskStatus.Completed);

    // 9. Verify: data persisted across connection lifecycle
    expect(getMessageCount(db3, taskId)).toBe(2);

    closeDatabase(db3);
  });
});

describe('Scenario 6: Project moved — re-init fixes paths', () => {
  let tmpDirA: string;
  let tmpDirB: string;

  beforeEach(() => {
    tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-s6a-'));
    tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-s6b-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDirA, { recursive: true, force: true });
    fs.rmSync(tmpDirB, { recursive: true, force: true });
  });

  it('re-init in new directory creates fresh structure; old data not lost', () => {
    // 1. Create project in temp dir A with init
    const bridgeDirA = path.join(tmpDirA, '.agent-bridge');
    const dbA = openDatabase(bridgeDirA);

    upsertAgent(dbA, { name: 'cursor-dev', role: 'developer', client: 'cursor' });
    upsertAgent(dbA, { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' });

    // 2. Create a task in dir A's DB
    const taskA = createTask(dbA, {
      task_type: TaskType.Review,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'Review before project move',
    });

    createMessage(dbA, {
      task_id: taskA.id,
      author: 'cursor-dev',
      kind: 'request',
      content: 'Please review this before we relocate the project.',
    });

    // Verify task exists in dir A
    expect(getTask(dbA, taskA.id)).not.toBeNull();
    expect(getTask(dbA, taskA.id)!.status).toBe(TaskStatus.Pending);
    expect(getMessageCount(dbA, taskA.id)).toBe(1);

    const taskAId = taskA.id;

    closeDatabase(dbA);

    // 3. Create project in temp dir B (simulate "move" by running init there)
    const bridgeDirB = path.join(tmpDirB, '.agent-bridge');
    const dbB = openDatabase(bridgeDirB);

    // 4. The task from dir A obviously won't be in dir B's new DB
    const taskInB = getTask(dbB, taskAId);
    expect(taskInB).toBeNull();

    // 5. Verify: init in new dir creates fresh valid structure
    //    We can create new agents and tasks in the new DB
    upsertAgent(dbB, { name: 'cursor-dev', role: 'developer', client: 'cursor' });
    upsertAgent(dbB, { name: 'claude-reviewer', role: 'reviewer', client: 'claude-code' });

    const taskB = createTask(dbB, {
      task_type: TaskType.Implement,
      sender: 'cursor-dev',
      receiver: 'claude-reviewer',
      summary: 'New task in relocated project',
    });
    expect(taskB.status).toBe(TaskStatus.Pending);
    expect(taskB.id).not.toBe(taskAId);

    createMessage(dbB, {
      task_id: taskB.id,
      author: 'cursor-dev',
      kind: 'request',
      content: 'We moved the project. Starting fresh tasks here.',
    });

    // Verify new DB is fully functional
    const inboxB = getTasksByReceiver(dbB, 'claude-reviewer', TaskStatus.Pending);
    expect(inboxB).toHaveLength(1);
    expect(inboxB[0].id).toBe(taskB.id);
    expect(getMessageCount(dbB, taskB.id)).toBe(1);

    closeDatabase(dbB);

    // 6. Verify: old dir's DB still has the original task (data not lost)
    const dbAReopen = openDatabase(bridgeDirA);

    const originalTask = getTask(dbAReopen, taskAId);
    expect(originalTask).not.toBeNull();
    expect(originalTask!.status).toBe(TaskStatus.Pending);
    expect(originalTask!.summary).toBe('Review before project move');

    const originalMessages = getMessagesByTask(dbAReopen, taskAId);
    expect(originalMessages).toHaveLength(1);
    expect(originalMessages[0].author).toBe('cursor-dev');
    expect(originalMessages[0].content).toContain('before we relocate');

    // Verify the old DB doesn't have dir B's task
    const taskBInA = getTask(dbAReopen, taskB.id);
    expect(taskBInA).toBeNull();

    closeDatabase(dbAReopen);

    // Verify both bridge directories exist with their own DB files
    expect(fs.existsSync(path.join(bridgeDirA, 'bridge.db'))).toBe(true);
    expect(fs.existsSync(path.join(bridgeDirB, 'bridge.db'))).toBe(true);
  });
});
