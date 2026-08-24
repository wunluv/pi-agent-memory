# pi-agent-memory — Explained Simply

A memory system for AI agents. It gives an agent a notebook it can actually
remember: what it knows about you, what it knows about each project, and what
happened in past conversations. Everything is plain markdown files stored in
git, so nothing is locked in a database and nothing is lost.

## The idea in one line

The agent writes short notes as it works. Each note is saved with a timestamp,
a summary, and a topic tag. Old notes stay out of the way until needed, then
load on demand.

## The three zones

**Zone A — Agent memory.** The agent's own identity and what it knows about
you: your background, your projects, how you like to communicate. Always
loaded, kept tiny (~850 tokens). Lives at `~/.pi/agents/<name>/memory/`.

**Zone B — Project memory.** Each project gets its own memory folder
(`<project>/.memory/`): strategy, status, decisions, observations. Loaded only
when you work on that project. Stays private, never in the public code repo.

**Zone C — Session archive.** Raw logs of past conversations, managed by pi
itself. Used to recall "what did we say about X last month?" and to mine
wisdom from how you actually work.

Plus one shared layer: **the org root** (`~/.pi/org/`). A single index that
remembers which agents, projects, and people exist and where they live. One
place, shared by all agents on a machine.

## What each piece is

| Thing | What it is |
|-------|-----------|
| **Agent** | A persistent identity with a unique id (`agent.json`). Independent of device or interface. You rename the folder, the id never changes. |
| **Project** | A body of work with its own memory. Has a unique id in `project.json` and a `.memory/` folder. |
| **Human** | The person an agent serves. Today, you. |
| **Org** | The operator of the system. The owner of the registry that ties agents, projects, and humans together. |
| **Memory file** | A markdown note with a short header: description, importance (1-5), tags, dates, and which agent wrote it. |
| **Wiki-links** | `[[links]]` inside notes that connect related files into a navigable graph. |
| **MemoryRoot** | The folder a zone resolves to: the agent's folder, or a project's `.memory/`. |
| **Registry** | The org's single index (`registry.json`): uuid → name and location for every project, agent, and human. |
| **Session root** | The active project's memory, set by `/startwork` so tools know where to read and write without being told every time. |
| **Sync server** | An optional private git server (a machine you control) that mirrors memory across devices. |

## How a working session flows

1. **`/startwork`** — you start working on a project. The agent finds the
   project's memory, sets the session root, and shows a quick overview: what's
   there, what changed recently, what's next.
2. **Work** — the agent reads project notes as needed, writes new ones, each
   one a git commit. You can browse the memory tree, read files, search, or ask
   "what did we decide about this?"
3. **`/endwork`** — the agent updates the project's status notes, commits
   everything, and clears the session. The next session starts fresh but
   informed.

## Why git

Git gives every note a history for free: who wrote what, when, and what
changed. If two agents edit the same project memory, git handles merging and
surfaces conflicts instead of silently overwriting. And with an optional
private server, memory syncs across machines the same way code does.

## What's deliberately simple

- Markdown files, not a database. You can open, search, and edit them with any
  tool.
- Progressive disclosure: the agent only loads what it needs, when it needs
  it. That's what keeps the cold start cheap and the context uncluttered.
- No external dependencies. Node built-ins only.
- Sync is a fire-and-forget background push after each write; a slow network
  never blocks the agent's reply.

## In one breath

Three zones: agent, project, session. One shared index: the org registry.
Unique ids that survive renames and moves. Git as the source of truth. Notes
in markdown, loaded on demand, synced privately when you want it. That's the
whole system.
