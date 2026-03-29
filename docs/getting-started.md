# Getting Started

This guide covers the agent activation flow -- the first steps after installing Agent Bridge.

## Scenario 1: New Project from Scratch

```bash
mkdir my-app && cd my-app && git init && npm init -y
agent-bridge init --mode manual
```

This creates the bridge structure, detects your installed clients (Cursor, Claude Code, Codex CLI), and prompts for agent names and roles.

### Activate Your Agents

Open each editor that has an agent configured. The first message to each agent should be:

```
/peer-collaborate
```

This activates the `peer-collaborate` skill, which instructs the agent to call `peer_status`. That call does two things:

1. Registers the agent as online (updates `last_seen` timestamp)
2. Shows who else is online and what tasks are pending

After activation, give your agents actual tasks:

```
User (to Cursor agent):
  "Review the Express API routes in src/routes/ -- check for error handling gaps and missing validation"

User (to Claude Code agent):
  "Refactor the JWT auth module to use refresh tokens. The current implementation in src/auth/jwt.ts uses only access tokens."
```

In manual mode (default), the user drives all collaboration. Autonomous mode is available but experimental -- see the setup guide for details.

## Scenario 2: Existing Project

```bash
cd ~/projects/existing-api
agent-bridge init --mode manual
```

Same activation flow -- open each editor and send `/peer-collaborate` as the first message.

In manual mode, you drive the collaboration explicitly:

```
User: "Send a review request to claude-reviewer for the auth changes"
User: "Check your inbox"
User: "Wait for the response from claude-reviewer"
```

## Activation Flow Summary

1. **Cursor users:** Make sure the `peer-collaborate` skill is enabled in Cursor settings before starting.
2. First message to each agent is always `/peer-collaborate`. This activates the agent and checks its inbox.
3. Agents call `peer_status` on activation, which marks them as online and shows the current bridge state.
4. Agents are considered **online** if seen within the last 5 minutes. The `peer_status` response includes an `online` field for each known agent.
5. When sending a task with `peer_send`, if the target agent appears offline, the tool returns a warning -- but the task is still created and will be delivered when the agent comes online.
6. In **manual mode** (default), the user drives all collaboration -- "send this to X", "check inbox", "check for response".
7. **Autonomous mode** is experimental -- agents attempt to check inbox proactively, but behavior varies by client.

## Example: Multi-Agent Code Review

```
# Terminal 1: Cursor (developer agent)
/peer-collaborate
"I've implemented the new payment endpoint in src/routes/payments.ts. Send it to claude-reviewer for review."

# Terminal 2: Claude Code (reviewer agent)
/peer-collaborate
# Agent sees the review task in inbox, reads the code, and replies with findings.

# Back in Terminal 1:
"Check if claude-reviewer has responded."
# Agent calls peer_check, sees the reply, reads it with peer_get_task.
```

## Example: JWT Refactor with Task Delegation

```
# Terminal 1: Claude Code (architect agent)
/peer-collaborate
"The JWT implementation needs refresh tokens. Break this into subtasks:
 1. Send cursor-dev a task to implement the refresh token endpoint
 2. Send codex-tester a task to write tests for the new flow"

# Terminal 2: Cursor (developer agent)
/peer-collaborate
# Picks up the implementation task, writes the code, replies with results.

# Terminal 3: Codex CLI (tester agent)
/peer-collaborate
# Picks up the testing task, writes tests, replies with results.

# Back in Terminal 1:
"Check on the subtasks."
# Architect agent polls both tasks, reviews results, marks them complete.
```
