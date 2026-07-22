# Pi Headless Agent — Research Notes

> How Pi supports persistent headless agents for Telegram/Slack/WhatsApp interfaces.
> Research date: 2026-07-22

## Key Findings

Pi v0.79.1 has all the primitives needed for a persistent headless agent with session continuity.

### Print Mode (+ Session ID) = Telegram Bot

```bash
pi -p "San: When did Kim O Bok last donate to Heavenletters?" \
   --continue \
   --session-id telegram-alph \
   --name "Telegram Bot - Alph"
```

What this does:
1. Runs **non-interactively** (`-p`) — processes the prompt and exits
2. **Continues** the same session (`--continue` + `--session-id`) — message history, memory tool context, and system prompt state all persist across invocations
3. Uses a **fixed session ID** (`telegram-alph`) — every Telegram message hits the same session file
4. **Saves and exits** — session written to `~/.pi/agent/sessions/<cwd-hash>/sess-telegram-alph.jsonl`

### Session Storage

Sessions auto-save to `~/.pi/agent/sessions/<cwd-hash>/`. Each session is a JSONL file with a tree structure (`id`/`parentId`).

```
~/.pi/agent/sessions/
├── --home-wunluv--DEV--Heaven/    ← cwd-hash for Heaven projects
│   └── sess-telegram-alph.jsonl   ← fixed session for Telegram bot
└── --home-wunluv--               ← cwd-hash for home dir
    └── sess-abc123.jsonl          ← interactive session
```

**Per-message flow:**

```
Telegram message arrives
  → bot spawns: pi -p "..." --continue --session-id telegram-alph
  → Pi opens sess-telegram-alph.jsonl
  → Loads message history (including memory tool results from prior turns)
  → Loads memory system (Zone A system/ files injected via extension)
  → Processes prompt, calls memory_read/memory_write as needed
  → Saves expanded session to JSONL
  → Returns response text via stdout
  → bot sends response to Telegram
  → Process exits
```

## Auto-Compaction: Solved

Pi's auto-compaction handles long-running sessions automatically:

```
contextTokens > contextWindow - reserveTokens (16K)
  → trigger compaction
  → summarize old messages into structured summary
  → free up context for new messages
```

Default settings: `reserveTokens: 16384`, `keepRecentTokens: 20000`. Configurable in `settings.json`.

A Telegram session that handles hundreds of messages over weeks will never overflow — Pi compacts older turns into summaries that preserve goals, decisions, and critical context.

## Three Integration Approaches

### A) Subprocess Per Message (recommended for MVP)

```python
# Telegram bot (Python)
import subprocess

def handle_message(text):
    result = subprocess.run([
        "pi", "-p", f"User via Telegram: {text}",
        "--continue", "--session-id", "telegram-alph",
        "--name", "Telegram Bot - Alph",
        "--no-approve"  # trust extensions, don't prompt
    ], capture_output=True, text=True, cwd="/home/wunluv/DEV/Heaven")
    return result.stdout
```

**Pros:** Simple, process isolation, no long-running process to manage, auto-restart on crash
**Cons:** Process startup overhead (~500ms-2s), no streaming to user (batch response only)

### B) RPC Mode (persistent process)

```bash
# Start once, keep alive
pi --mode rpc --session-id telegram-alph --name "Telegram Bot - Alph"
```

```python
# Bot sends JSON commands via stdin, receives events via stdout
proc.stdin.write(json.dumps({"type": "prompt", "message": "..."}) + "\n")
# Stream response in real-time
```

**Pros:** Instant response (no startup), streaming output, all Pi events available
**Cons:** Process management (restart on crash, health checks), session state tied to process lifetime

### C) SDK (in-process)

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.open("/path/to/telegram-alph.jsonl"),
  // ... model, tools, extensions
});

session.subscribe((event) => { /* stream to Telegram */ });
await session.prompt("User via Telegram: ...");
```

**Pros:** Full control, no subprocess, type-safe
**Cons:** Node.js only, more setup code, extension loading more manual

## Recommendation

**Start with Approach A (subprocess per message).** It's 20 lines of Python for the bot. Pi handles session persistence, compaction, and memory system injection automatically. If latency becomes an issue (process startup time), graduate to Approach B (RPC mode). Avoid Approach C for initial deployment — the subprocess model gives you everything the SDK does with zero integration code for memory and extensions.

## Memory System Integration

The pi-agent-memory extension loads automatically (symlink in `~/.pi/agent/extensions/`). In headless mode:

- Zone A (system/ files): injected into every turn by the `before_agent_start` hook — same as interactive mode
- Zone B (project memory): accessible via memory tools if session cwd has a `.memory/` directory
- Session root: set by `/startwork` command, which the agent can issue via tool call

For Telegram, the agent runs with cwd set to the working directory. To make project memory available, set cwd to a project root (e.g., `~/DEV/Heaven/`) when spawning pi.

## Session Isolation

Multiple bots/channels can use different session IDs:

```bash
pi -p "..." --continue --session-id telegram-alph      # Telegram
pi -p "..." --continue --session-id slack-alph          # Slack
pi -p "..." --continue --session-id whatsapp-alph       # WhatsApp
```

Each gets its own session file, its own message history, its own compaction cycle. All share the same Zone A memory (agent identity/persona) but maintain separate conversation context.

## Edge Cases

| Concern | Resolution |
|---------|-----------|
| Message arrives while previous still processing | `--continue` opens same session — pi handles concurrent access via file locking? Check pi docs. |
| Session file grows too large | Auto-compaction keeps it within context window. JSONL file size proportional to compacted summary + recent messages, not total history. |
| Process crash mid-response | Telegram message lost. Bot retries. `--continue` picks up last saved state — may re-process. |
| Multiple devices, different session state | This is a sync problem, not a session problem. Zone A syncs via pi-memory-server (Phase 2). Sessions are device-local. |
| Agent needs to use memory tools that require /startwork | Agent can call `/startwork Heavenletters` as a command. Pi processes it, sets session root, loads eagle eye. |
