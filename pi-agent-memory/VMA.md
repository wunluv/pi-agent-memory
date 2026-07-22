# VMA — pi-agent-memory

> Vision, Mission, Aims (Sociocracy 3.0)

## Vision

Stateful Human & Machine collaboration constantly evolving towards a bright future for all of life.

## Mission

The human-agent dyad builds shared continuity over time without paying token tax to reconstruct context from scratch. Provide pi agents with a lightweight three-zone memory system — always-present identity and relationship (Zone A), session-scoped project context (Zone B), and searchable conversation history (Zone C). Git-backed markdown with progressive disclosure: browse descriptions before loading content. Under 900 tokens cold start. Zero external dependencies beyond Node.js built-ins.

## Aims

### Core (built)

1. Cold start under 900 tokens for Zone A
2. Progressive disclosure — `memory_tree()` descriptions free, `memory_read()` loads on demand
3. `/memory:init` detects org vs standalone patterns, bootstraps `.memory/`
4. `/startwork` → session root → `/endwork` workflow with auto-commits
5. `AGENTS.md` bridge for sub-projects in org structures
6. `memory_write` auto-committed to local git (history, blame, rollback)
7. `[[wiki-links]]` navigable memory graph across files
8. Session recall via `memory_recall()` and super_sessions pipeline

### Next (Phase 2)

9. **Memory server sync** — agent memory (Zone A) syncs to a remote git server. Agents access memory from any device. `memory_write` auto-pushes, session start auto-pulls. Protocol: standard git remotes (Letta memfs, GitHub, bare repo). No custom wire protocol.

10. **Auto-discovered org memory** — agents walk up from cwd to find `.memory/`. No explicit `root` parameter needed for sub-projects. Same convention as git, npm, eslint: look up the tree. `/startwork` becomes a session ritual (load eagle eye, present priorities), not a requirement for basic operation.

11. **Archival memory** — vector semantic search over large reference documents. Store → chunk → embed → retrieve. Backend: sentence-transformers (all-MiniLM-L6-v2) + SQLite + numpy. Proven at 6,617 Heavenletters in heaven-search. `memory_archive_store()` and `memory_archive_search()` tools. Archive lives in `.memory/archive/` (Zone B) and `~/.pi/agents/<agent>/memory/archive/` (Zone A).

## Scope (Deferred)

- Autonomous dreaming/reflection agents
- Multi-agent coordination
- Memory compaction / summarization
- Cross-agent shared memory
