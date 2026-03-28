import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, closeDatabase } from '../../src/store/database.js';
import { createTask, getTask, getTasksByReceiver, updateTaskStatus } from '../../src/store/tasks.js';
import { createMessage, getMessagesByTask, getMessageCount } from '../../src/store/messages.js';
import { upsertAgent } from '../../src/store/agents.js';
import { TaskType, TaskStatus } from '../../src/domain/models.js';
import { isTerminal } from '../../src/domain/status.js';
import type BetterSqlite3 from 'better-sqlite3';

let tmpDir: string;
let bridgeDir: string;
let db: BetterSqlite3.Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-workflows-'));
  bridgeDir = path.join(tmpDir, '.agent-bridge');
  db = openDatabase(bridgeDir);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Small delay to ensure distinct created_at timestamps between messages. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

describe('workflow e2e: code review pipeline', () => {
  it('4 agents coordinate a full code review with QA', async () => {
    // Setup agents
    upsertAgent(db, { name: 'frontend-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'backend-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'senior-reviewer', role: 'reviewer', client: 'claude' });
    upsertAgent(db, { name: 'qa-tester', role: 'tester', client: 'windsurf' });

    // 1. frontend-dev sends review task to senior-reviewer
    const task1 = createTask(db, {
      task_type: TaskType.Review,
      sender: 'frontend-dev',
      receiver: 'senior-reviewer',
      summary: 'Review new dashboard component',
    });
    createMessage(db, {
      task_id: task1.id,
      author: 'frontend-dev',
      kind: 'request',
      content: 'Review new dashboard component',
    });

    // 2. backend-dev sends review task to senior-reviewer
    const task2 = createTask(db, {
      task_type: TaskType.Review,
      sender: 'backend-dev',
      receiver: 'senior-reviewer',
      summary: 'Review API endpoint changes',
    });
    createMessage(db, {
      task_id: task2.id,
      author: 'backend-dev',
      kind: 'request',
      content: 'Review API endpoint changes',
    });

    // 3. senior-reviewer checks inbox -> sees 2 pending tasks
    const inbox = getTasksByReceiver(db, 'senior-reviewer', TaskStatus.Pending);
    expect(inbox).toHaveLength(2);
    expect(inbox.map((t) => t.id).sort()).toEqual([task1.id, task2.id].sort());

    // 4. senior-reviewer gets task 1 (-> active), reviews, replies
    updateTaskStatus(db, task1.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: task1.id,
      author: 'senior-reviewer',
      kind: 'reply',
      content: 'Needs accessibility fixes',
    });

    // 5. senior-reviewer gets task 2 (-> active), reviews, replies
    updateTaskStatus(db, task2.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: task2.id,
      author: 'senior-reviewer',
      kind: 'reply',
      content: 'Looks good, needs tests',
    });

    // 6. senior-reviewer sends test task to qa-tester
    const task3 = createTask(db, {
      task_type: TaskType.Test,
      sender: 'senior-reviewer',
      receiver: 'qa-tester',
      summary: 'Test API endpoints',
    });
    createMessage(db, {
      task_id: task3.id,
      author: 'senior-reviewer',
      kind: 'request',
      content: 'Test API endpoints',
    });

    // 7. frontend-dev gets review reply, applies fixes
    const task1Messages = getMessagesByTask(db, task1.id);
    expect(task1Messages).toHaveLength(2);
    expect(task1Messages[1].content).toBe('Needs accessibility fixes');

    // 8. frontend-dev replies to original task with fix confirmation
    await tick();
    createMessage(db, {
      task_id: task1.id,
      author: 'frontend-dev',
      kind: 'reply',
      content: 'Fixed accessibility issues',
    });

    // 9. qa-tester checks inbox, gets test task, runs tests
    const qaInbox = getTasksByReceiver(db, 'qa-tester', TaskStatus.Pending);
    expect(qaInbox).toHaveLength(1);
    expect(qaInbox[0].id).toBe(task3.id);
    updateTaskStatus(db, task3.id, TaskStatus.Active);

    // 10. qa-tester replies with test results
    await tick();
    createMessage(db, {
      task_id: task3.id,
      author: 'qa-tester',
      kind: 'reply',
      content: 'All 15 tests passing',
    });

    // 11. senior-reviewer gets qa results, completes test task
    const task3Messages = getMessagesByTask(db, task3.id);
    expect(task3Messages).toHaveLength(2);
    expect(task3Messages[1].content).toBe('All 15 tests passing');
    updateTaskStatus(db, task3.id, TaskStatus.Completed);

    // 12. senior-reviewer completes both review tasks
    updateTaskStatus(db, task1.id, TaskStatus.Completed);
    updateTaskStatus(db, task2.id, TaskStatus.Completed);

    // 13. Verify: 3 tasks all completed, correct message counts
    const finalTask1 = getTask(db, task1.id);
    const finalTask2 = getTask(db, task2.id);
    const finalTask3 = getTask(db, task3.id);

    expect(finalTask1!.status).toBe(TaskStatus.Completed);
    expect(finalTask2!.status).toBe(TaskStatus.Completed);
    expect(finalTask3!.status).toBe(TaskStatus.Completed);

    expect(getMessageCount(db, task1.id)).toBe(3); // request + reply + fix reply
    expect(getMessageCount(db, task2.id)).toBe(2); // request + reply
    expect(getMessageCount(db, task3.id)).toBe(2); // request + reply
  });
});

describe('workflow e2e: bug fix relay', () => {
  it('3 agents relay a bug through triage, debug, and fix', async () => {
    upsertAgent(db, { name: 'triage-agent', role: 'triage', client: 'claude' });
    upsertAgent(db, { name: 'debugger-agent', role: 'debugger', client: 'cursor' });
    upsertAgent(db, { name: 'fixer-agent', role: 'developer', client: 'windsurf' });

    // 1. triage-agent sends debug task to debugger-agent
    const debugTask = createTask(db, {
      task_type: TaskType.Debug,
      sender: 'triage-agent',
      receiver: 'debugger-agent',
      summary: 'Investigate memory leak in worker pool',
    });
    createMessage(db, {
      task_id: debugTask.id,
      author: 'triage-agent',
      kind: 'request',
      content: 'Investigate memory leak in worker pool',
    });

    // 2. debugger-agent gets task, investigates
    updateTaskStatus(db, debugTask.id, TaskStatus.Active);

    // 3. debugger-agent replies with root cause
    await tick();
    createMessage(db, {
      task_id: debugTask.id,
      author: 'debugger-agent',
      kind: 'reply',
      content: 'Root cause: connection pool not closing on worker exit',
    });

    // 4. debugger-agent sends implement task to fixer-agent
    const fixTask = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'debugger-agent',
      receiver: 'fixer-agent',
      summary: 'Fix connection pool cleanup',
    });
    createMessage(db, {
      task_id: fixTask.id,
      author: 'debugger-agent',
      kind: 'request',
      content: 'Fix connection pool cleanup',
    });

    // debugger-agent waits for fixer
    updateTaskStatus(db, debugTask.id, TaskStatus.WaitingReply);

    // 5. fixer-agent gets task, implements fix
    updateTaskStatus(db, fixTask.id, TaskStatus.Active);

    // 6. fixer-agent replies with fix details
    await tick();
    createMessage(db, {
      task_id: fixTask.id,
      author: 'fixer-agent',
      kind: 'reply',
      content: 'Fixed in worker.ts, added cleanup on exit handler',
    });

    // 7. debugger-agent gets fix confirmation, completes fix task
    const fixMessages = getMessagesByTask(db, fixTask.id);
    expect(fixMessages).toHaveLength(2);
    expect(fixMessages[1].content).toContain('Fixed in worker.ts');
    updateTaskStatus(db, fixTask.id, TaskStatus.Completed);

    // 8. debugger-agent replies to triage with resolution
    updateTaskStatus(db, debugTask.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: debugTask.id,
      author: 'debugger-agent',
      kind: 'reply',
      content: 'Bug fixed and verified',
    });

    // 9. triage-agent completes original task
    updateTaskStatus(db, debugTask.id, TaskStatus.Completed);

    // 10. Verify entire chain completed, all messages correct
    const finalDebugTask = getTask(db, debugTask.id);
    const finalFixTask = getTask(db, fixTask.id);

    expect(finalDebugTask!.status).toBe(TaskStatus.Completed);
    expect(finalFixTask!.status).toBe(TaskStatus.Completed);

    const debugMessages = getMessagesByTask(db, debugTask.id);
    expect(debugMessages).toHaveLength(3); // request + root cause + fixed
    expect(debugMessages[0].author).toBe('triage-agent');
    expect(debugMessages[0].kind).toBe('request');
    expect(debugMessages[1].author).toBe('debugger-agent');
    expect(debugMessages[1].kind).toBe('reply');
    expect(debugMessages[2].author).toBe('debugger-agent');
    expect(debugMessages[2].kind).toBe('reply');

    const fixTaskMessages = getMessagesByTask(db, fixTask.id);
    expect(fixTaskMessages).toHaveLength(2); // request + fix reply
    expect(fixTaskMessages[0].author).toBe('debugger-agent');
    expect(fixTaskMessages[1].author).toBe('fixer-agent');
  });
});

describe('workflow e2e: architecture decision with voting', () => {
  it('architect collects votes from 3 agents in parallel', async () => {
    upsertAgent(db, { name: 'architect', role: 'architect', client: 'claude' });
    upsertAgent(db, { name: 'backend-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'frontend-dev', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'devops-agent', role: 'devops', client: 'windsurf' });

    const question = 'Should we use GraphQL or REST for new API?';

    // 1. architect sends question to backend-dev
    const task1 = createTask(db, {
      task_type: TaskType.Question,
      sender: 'architect',
      receiver: 'backend-dev',
      summary: question,
    });
    createMessage(db, {
      task_id: task1.id,
      author: 'architect',
      kind: 'request',
      content: question,
    });

    // 2. architect sends same question to frontend-dev
    const task2 = createTask(db, {
      task_type: TaskType.Question,
      sender: 'architect',
      receiver: 'frontend-dev',
      summary: question,
    });
    createMessage(db, {
      task_id: task2.id,
      author: 'architect',
      kind: 'request',
      content: question,
    });

    // 3. architect sends same question to devops-agent
    const task3 = createTask(db, {
      task_type: TaskType.Question,
      sender: 'architect',
      receiver: 'devops-agent',
      summary: question,
    });
    createMessage(db, {
      task_id: task3.id,
      author: 'architect',
      kind: 'request',
      content: question,
    });

    // Verify all 3 tasks created and pending
    expect(getTasksByReceiver(db, 'backend-dev', TaskStatus.Pending)).toHaveLength(1);
    expect(getTasksByReceiver(db, 'frontend-dev', TaskStatus.Pending)).toHaveLength(1);
    expect(getTasksByReceiver(db, 'devops-agent', TaskStatus.Pending)).toHaveLength(1);

    // 4. backend-dev replies
    updateTaskStatus(db, task1.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: task1.id,
      author: 'backend-dev',
      kind: 'reply',
      content: 'REST — simpler, our team knows it well',
    });

    // 5. frontend-dev replies
    updateTaskStatus(db, task2.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: task2.id,
      author: 'frontend-dev',
      kind: 'reply',
      content: 'GraphQL — flexible queries, less over-fetching',
    });

    // 6. devops-agent replies
    updateTaskStatus(db, task3.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: task3.id,
      author: 'devops-agent',
      kind: 'reply',
      content: 'REST — better caching at CDN level',
    });

    // 7. architect gets all 3 replies
    const replies1 = getMessagesByTask(db, task1.id);
    const replies2 = getMessagesByTask(db, task2.id);
    const replies3 = getMessagesByTask(db, task3.id);

    expect(replies1).toHaveLength(2);
    expect(replies2).toHaveLength(2);
    expect(replies3).toHaveLength(2);

    expect(replies1[1].content).toContain('REST');
    expect(replies2[1].content).toContain('GraphQL');
    expect(replies3[1].content).toContain('REST');

    // 8. architect completes all 3 tasks
    updateTaskStatus(db, task1.id, TaskStatus.Completed);
    updateTaskStatus(db, task2.id, TaskStatus.Completed);
    updateTaskStatus(db, task3.id, TaskStatus.Completed);

    // 9. Verify: 3 parallel tasks, each with 2 messages, all completed
    for (const taskId of [task1.id, task2.id, task3.id]) {
      const task = getTask(db, taskId);
      expect(task!.status).toBe(TaskStatus.Completed);
      expect(getMessageCount(db, taskId)).toBe(2);
    }
  });
});

describe('workflow e2e: iterative review with multiple rounds', () => {
  it('developer and reviewer go back and forth until approval', async () => {
    upsertAgent(db, { name: 'developer', role: 'developer', client: 'cursor' });
    upsertAgent(db, { name: 'reviewer', role: 'reviewer', client: 'claude' });

    // 1. developer sends review task to reviewer
    const task = createTask(db, {
      task_type: TaskType.Review,
      sender: 'developer',
      receiver: 'reviewer',
      summary: 'Review authentication module refactor',
    });
    createMessage(db, {
      task_id: task.id,
      author: 'developer',
      kind: 'request',
      content: 'Please review the authentication module refactor',
    });
    updateTaskStatus(db, task.id, TaskStatus.Active);

    // 2. reviewer replies: issues found
    await tick();
    createMessage(db, {
      task_id: task.id,
      author: 'reviewer',
      kind: 'reply',
      content: 'Issues found: 1. No error handling, 2. Missing validation',
    });

    // 3. developer replies: partial fix
    await tick();
    createMessage(db, {
      task_id: task.id,
      author: 'developer',
      kind: 'reply',
      content: 'Fixed error handling, working on validation',
    });

    // 4. reviewer replies: progress acknowledged
    await tick();
    createMessage(db, {
      task_id: task.id,
      author: 'reviewer',
      kind: 'reply',
      content: 'Error handling looks good, still need validation',
    });

    // 5. developer replies: validation added
    await tick();
    createMessage(db, {
      task_id: task.id,
      author: 'developer',
      kind: 'reply',
      content: 'Validation added',
    });

    // 6. reviewer replies: approved
    await tick();
    createMessage(db, {
      task_id: task.id,
      author: 'reviewer',
      kind: 'reply',
      content: 'LGTM, approved',
    });

    // 6b. developer acknowledges approval
    await tick();
    createMessage(db, {
      task_id: task.id,
      author: 'developer',
      kind: 'note',
      content: 'Thanks, merging now',
    });

    // 7. developer completes task
    updateTaskStatus(db, task.id, TaskStatus.Completed);

    // 8. Verify: task completed, 7 messages total, alternating authors
    const finalTask = getTask(db, task.id);
    expect(finalTask!.status).toBe(TaskStatus.Completed);

    const messages = getMessagesByTask(db, task.id);
    expect(messages).toHaveLength(7); // 1 request + 6 replies

    // Verify alternating authors: dev, rev, dev, rev, dev, rev, dev
    const expectedAuthors = [
      'developer',
      'reviewer',
      'developer',
      'reviewer',
      'developer',
      'reviewer',
      'developer',
    ];
    // First message is request from developer
    expect(messages[0].author).toBe('developer');
    expect(messages[0].kind).toBe('request');

    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].author).toBe(expectedAuthors[i]);
    }

    // Verify timestamps are monotonically increasing
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].created_at > messages[i - 1].created_at).toBe(true);
    }
  });
});

describe('workflow e2e: cascading task failure and recovery', () => {
  it('worker-a delegates sub-task to worker-b before completing', async () => {
    upsertAgent(db, { name: 'orchestrator', role: 'orchestrator', client: 'claude' });
    upsertAgent(db, { name: 'worker-a', role: 'deployer', client: 'cursor' });
    upsertAgent(db, { name: 'worker-b', role: 'dba', client: 'windsurf' });

    // 1. orchestrator sends task to worker-a
    const deployTask = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'orchestrator',
      receiver: 'worker-a',
      summary: 'Deploy to staging',
    });
    createMessage(db, {
      task_id: deployTask.id,
      author: 'orchestrator',
      kind: 'request',
      content: 'Deploy to staging',
    });

    // 2. worker-a gets task, starts working
    updateTaskStatus(db, deployTask.id, TaskStatus.Active);

    // 3. worker-a realizes it needs DB migration, sends sub-task to worker-b
    const migrationTask = createTask(db, {
      task_type: TaskType.Implement,
      sender: 'worker-a',
      receiver: 'worker-b',
      summary: 'Need DB migration first',
    });
    createMessage(db, {
      task_id: migrationTask.id,
      author: 'worker-a',
      kind: 'request',
      content: 'Need DB migration first',
    });

    // worker-a waits for migration
    updateTaskStatus(db, deployTask.id, TaskStatus.WaitingReply);

    // 4. worker-b gets task, does migration
    updateTaskStatus(db, migrationTask.id, TaskStatus.Active);

    // 5. worker-b replies: migration complete
    await tick();
    createMessage(db, {
      task_id: migrationTask.id,
      author: 'worker-b',
      kind: 'reply',
      content: 'Migration complete',
    });

    // 6. worker-a completes sub-task
    updateTaskStatus(db, migrationTask.id, TaskStatus.Completed);

    // 7. worker-a replies to orchestrator
    updateTaskStatus(db, deployTask.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: deployTask.id,
      author: 'worker-a',
      kind: 'reply',
      content: 'Staging deployed after DB migration',
    });

    // 8. orchestrator completes task
    updateTaskStatus(db, deployTask.id, TaskStatus.Completed);

    // 9. Verify: both tasks completed, dependency chain preserved in messages
    const finalDeployTask = getTask(db, deployTask.id);
    const finalMigrationTask = getTask(db, migrationTask.id);

    expect(finalDeployTask!.status).toBe(TaskStatus.Completed);
    expect(finalMigrationTask!.status).toBe(TaskStatus.Completed);

    const deployMessages = getMessagesByTask(db, deployTask.id);
    expect(deployMessages).toHaveLength(2);
    expect(deployMessages[0].author).toBe('orchestrator');
    expect(deployMessages[0].kind).toBe('request');
    expect(deployMessages[1].author).toBe('worker-a');
    expect(deployMessages[1].kind).toBe('reply');
    expect(deployMessages[1].content).toContain('DB migration');

    const migrationMessages = getMessagesByTask(db, migrationTask.id);
    expect(migrationMessages).toHaveLength(2);
    expect(migrationMessages[0].author).toBe('worker-a');
    expect(migrationMessages[1].author).toBe('worker-b');
    expect(migrationMessages[1].content).toBe('Migration complete');
  });
});

describe('workflow e2e: task expiration during workflow', () => {
  it('expired task is filtered from inbox and rejects replies, normal task works', async () => {
    upsertAgent(db, { name: 'agent-a', role: 'developer', client: 'claude' });
    upsertAgent(db, { name: 'agent-b', role: 'reviewer', client: 'cursor' });

    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();

    // 1. agent-a sends task to agent-b with expires_at in the past
    const expiredTask = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Expired review task',
      expires_at: pastDate,
    });
    createMessage(db, {
      task_id: expiredTask.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review this urgently',
    });

    // 2. agent-a sends another task with normal expiration
    const normalTask = createTask(db, {
      task_type: TaskType.Review,
      sender: 'agent-a',
      receiver: 'agent-b',
      summary: 'Normal review task',
      expires_at: futureDate,
    });
    createMessage(db, {
      task_id: normalTask.id,
      author: 'agent-a',
      kind: 'request',
      content: 'Please review this at your convenience',
    });

    // 3. agent-b checks inbox -> expired task should be filtered, only normal task visible
    const pendingTasks = getTasksByReceiver(db, 'agent-b', TaskStatus.Pending);
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0].id).toBe(normalTask.id);

    // 4. agent-b tries to get expired task -> status is expired
    const fetchedExpired = getTask(db, expiredTask.id);
    expect(fetchedExpired).not.toBeNull();
    expect(fetchedExpired!.status).toBe(TaskStatus.Expired);

    // 5. agent-b tries to reply to expired task -> should fail (terminal state)
    //    isTerminal check mirrors what the MCP tool handler does
    expect(isTerminal(fetchedExpired!.status)).toBe(true);

    // Attempting status transition on expired task throws
    expect(() => updateTaskStatus(db, expiredTask.id, TaskStatus.Active)).toThrow();

    // 6. agent-b works on normal task successfully
    updateTaskStatus(db, normalTask.id, TaskStatus.Active);
    await tick();
    createMessage(db, {
      task_id: normalTask.id,
      author: 'agent-b',
      kind: 'reply',
      content: 'Review complete, looks good',
    });
    updateTaskStatus(db, normalTask.id, TaskStatus.Completed);

    // 7. Verify: expired task is terminal, normal task completed
    const finalExpired = getTask(db, expiredTask.id);
    const finalNormal = getTask(db, normalTask.id);

    expect(finalExpired!.status).toBe(TaskStatus.Expired);
    expect(isTerminal(finalExpired!.status)).toBe(true);

    expect(finalNormal!.status).toBe(TaskStatus.Completed);
    expect(getMessageCount(db, normalTask.id)).toBe(2);
    expect(getMessageCount(db, expiredTask.id)).toBe(1); // only the original request
  });
});

describe('workflow e2e: high volume — 5 agents, 20 tasks', () => {
  it('each agent sends 4 tasks and receives 4 tasks, all completed', async () => {
    const agentNames = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];

    // Setup agents
    for (const name of agentNames) {
      upsertAgent(db, { name, role: 'developer', client: 'claude' });
    }

    // 1. Each agent sends 4 tasks (1 to each other agent) — 20 tasks total
    const allTasks: Array<{ id: string; sender: string; receiver: string }> = [];

    for (const sender of agentNames) {
      for (const receiver of agentNames) {
        if (sender === receiver) continue;
        const task = createTask(db, {
          task_type: TaskType.Implement,
          sender,
          receiver,
          summary: `Task from ${sender} to ${receiver}`,
        });
        createMessage(db, {
          task_id: task.id,
          author: sender,
          kind: 'request',
          content: `Implementation request from ${sender}`,
        });
        allTasks.push({ id: task.id, sender, receiver });
      }
    }

    expect(allTasks).toHaveLength(20);

    // 2. Each agent checks inbox -> sees exactly 4 tasks
    for (const name of agentNames) {
      const inbox = getTasksByReceiver(db, name, TaskStatus.Pending);
      expect(inbox).toHaveLength(4);

      // Verify no task is misrouted
      for (const task of inbox) {
        expect(task.receiver).toBe(name);
        expect(task.sender).not.toBe(name);
      }
    }

    // 3. Each agent replies to all 4 tasks
    for (const name of agentNames) {
      const inbox = getTasksByReceiver(db, name, TaskStatus.Pending);
      for (const task of inbox) {
        updateTaskStatus(db, task.id, TaskStatus.Active);
        await tick();
        createMessage(db, {
          task_id: task.id,
          author: name,
          kind: 'reply',
          content: `Done — reply from ${name}`,
        });
      }
    }

    // 4. Each agent completes their sent tasks
    for (const { id } of allTasks) {
      updateTaskStatus(db, id, TaskStatus.Completed);
    }

    // 5. Verify: all 20 tasks completed, 40 messages total (20 requests + 20 replies)
    let totalMessages = 0;
    for (const { id } of allTasks) {
      const task = getTask(db, id);
      expect(task!.status).toBe(TaskStatus.Completed);

      const msgCount = getMessageCount(db, id);
      expect(msgCount).toBe(2); // 1 request + 1 reply
      totalMessages += msgCount;
    }
    expect(totalMessages).toBe(40);

    // 6. Verify: no task misrouted, each agent's inbox had exactly 4 tasks
    for (const name of agentNames) {
      // All tasks for this receiver should be completed now
      const allForReceiver = getTasksByReceiver(db, name);
      expect(allForReceiver).toHaveLength(4);
      for (const task of allForReceiver) {
        expect(task.status).toBe(TaskStatus.Completed);
        expect(task.receiver).toBe(name);
      }

      // Verify sent tasks
      const sentTasks = allTasks.filter((t) => t.sender === name);
      expect(sentTasks).toHaveLength(4);
    }
  });
});
