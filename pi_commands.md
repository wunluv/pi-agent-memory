# pi Harness — Slash Command Reference

Slash commands built into the pi harness itself, plus the namespaced commands that
extensions, skills, and prompt templates add on top.

Source: `@earendil-works/pi-coding-agent` README (`### Commands`), verified against the
installed v0.84.4 bundle. Local inventory section reflects this machine (Thor).

Type `/` in the editor to trigger the command list.

---

## Built-in commands

### Providers & models

| Command | Description |
|---------|-------------|
| `/login [provider]` | Configure provider authentication |
| `/logout [provider]` | Remove provider authentication |
| `/model [provider/model]` | Select model; Ctrl+S in the picker saves the startup default |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/thinking [level]` | Set thinking level; Ctrl+S saves the startup default |
| `/llama` | Download, load, unload llama.cpp router models (see `docs/llama-cpp.md`) |

### Session control

| Command | Description |
|---------|-------------|
| `/new` | Start a new session |
| `/resume` | Resume a different session |
| `/name <name>` | Set session display name |
| `/session` | Show session info and stats |
| `/tree` | Navigate the session tree, switch branches |
| `/fork` | Create a new fork from a previous user message |
| `/clone` | Duplicate the current session at the current position |
| `/compact [prompt]` | Manually compact context, optional custom instructions |
| `/quit` | Quit pi |

### Session I/O

| Command | Description |
|---------|-------------|
| `/copy` | Copy last agent message to clipboard |
| `/export [file]` | Export session (HTML default; path may be `.html` or `.jsonl`) |
| `/import <file>` | Import and resume a session from a JSONL file |
| `/share` | Share session as a secret GitHub gist |

### Config & environment

| Command | Description |
|---------|-------------|
| `/settings` | Theme, message delivery, transport, other preferences |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, context files |
| `/trust` | Save project trust decision for future sessions (restart required) |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |

### Hidden dispatch-only commands

These live in the same `if (text === …)` dispatch chain as the commands above, but they are
**absent from the `BUILTIN_SLASH_COMMANDS` palette array**, so `/` completion never offers them.
Typing them in full still works.

| Command | What it actually does |
|---------|------------------------|
| `/debug` | Diagnostic dump, not a joke. Renders the full TUI at the current terminal size, records each line with its visible width, appends every session message as JSONL, and writes it to `~/.pi/agent/pi-debug.log` (override dir via `PI_CODING_AGENT_DIR`). Confirms with “✓ Debug log written” plus the path. |
| `/arminsayshi` | Easter egg. Plays a 31×36 one-bit block-art portrait (decoded from a `BITS` bitmap in the bundle) using one of seven randomly chosen animations: `typewriter`, `scanline`, `rain`, `fade`, `crt`, `glitch`, `dissolve`. Final caption reads `ARMIN SAYS HI`. |
| `/dementedelves` | Easter egg. Renders a bordered announcement: bold **“pi has joined Earendil”**, a blog link to `https://mariozechner.at/posts/2026-04-08-ive-sold-out/`, and the bundled image `dist/modes/interactive/assets/clankolas.png` (640×537 RGB, 526 KB) at up to 56 cells wide. “Demented elves” is a wink at Earendil, the Tolkien mariner. The post itself is Mario Zechner's April 2026 announcement that he and pi joined Earendil (with Armin Ronacher, Cristina, Jakob, Ramiz, Vegard, Colin). |

### Auto-triggered easter egg

| Trigger | Effect |
|---------|--------|
| Selecting an `opencode` model whose id contains `kimi-k2.5` | `checkDaxnutsEasterEgg()` fires on model switch. Uncovers a 32×32 truecolor pixel image (6 hex-bytes per pixel, block-rendered) over 25 frames, then prints `Free Kimi K2.5 via OpenCode Zen`, `"Powered by daxnuts"`, credit `@thdxr`, and `Try OpenCode` linked to the Mistral Vibe 2.0 announcement. No slash command; you reach it by switching models. |

### Note on `/llama`

`/llama` is not in `BUILTIN_SLASH_COMMANDS` either. It comes from a hidden built-in
extension: `builtInExtensions = [{ name: "llama.cpp", factory: llamaExtension, hidden: true }]`.

---

## Namespaced command sources

Three mechanisms add commands without touching the harness:

| Source | Form | Example on this machine |
|--------|------|-------------------------|
| Extension | `/name`, `/ns:name` | `/startwork`, `/agent:sync`, `/memory:tree`, `/todos`, `/temp`, `/super_sessions` |
| Skill | `/skill:<name>` | `/skill:youtube-audio` |
| Prompt template | `/<template-name>` | `/implement`, `/scout-and-plan`, `/ytaudio` (from `~/.pi/agent/prompts/`) |

Extension commands in the `<ns>:<verb>` form come from a single extension registering
multiple commands. Bare names are also valid (`/startwork`, `/remember`).

---

## Local inventory (Thor)

### Extensions — `~/.pi/agent/extensions/`

| Extension | Commands |
|-----------|----------|
| `pi-agent-memory` (symlink → `~/DEV/pi/agent_memory/pi-agent-memory`) | 15 commands, 7 tools. See `agent_memory_commands.md` |
| `super-sessions/` | `/super_sessions`, `/super-sessions-tag`, `/super-sessions-retag` |
| `todo.ts` | `/todos` — show all todos on the current branch |
| `session-temperature.ts` | `/temp` — set LLM temperature for this session |
| `question.ts`, `questionnaire.ts` | Tools only (`question`, `questionnaire`) |
| `subagent/` | Tool only (`subagent`) |

### Skills — `~/.pi/agent/skills/`

- `youtube-audio` → `/skill:youtube-audio`

### Prompt templates — `~/.pi/agent/prompts/`

| Template | Purpose |
|----------|---------|
| `/implement` | Scout → planner → worker chain |
| `/implement-and-review` | Worker → reviewer → worker applies feedback |
| `/scout-and-plan` | Scout → planner, no implementation |
| `/ytaudio` | Wrapper around the youtube-audio skill, `[-m] <url> [folder]` |

### Subagents — `~/.pi/agent/agents/` (not slash commands)

`scout` · `planner` · `worker` · `implementer` · `reviewer`

Invoked via the `subagent` tool, or indirectly by the templates above. Project-local agents
in `.pi/agents/` require `agentScope: "both"`.

---

## Not slash commands, but adjacent

| Syntax | Effect |
|--------|--------|
| `@` | Fuzzy-search project files, insert as reference |
| `!command` | Run a bash command and send the output to the model |
| `!!command` | Run a bash command without sending the output |
| Tab | Path completion |
| Shift+Enter | Multi-line input |
| Ctrl+G | Open external editor (`$VISUAL` / `$EDITOR` / nano) |
| Ctrl+V | Paste image or text |

Full keybinding list: `/hotkeys` or `docs/keybindings.md`.

---

## Reference docs

Installed package docs live at:

```
~/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/
  README.md            main reference
  docs/                settings, keybindings, extensions, skills, sdk, sessions, …
  examples/            extensions, custom tools, SDK
```

`/reload` applies changes to extensions, skills, prompts, themes, and keybindings without
restarting. A newly added extension requires a restart so its `index.ts` is read at load.
