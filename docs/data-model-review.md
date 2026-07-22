# Gate 1 — Data Model Review

> Objective review. Flagging gaps, contradictions, and over-modeling.

## Strengths

The model captures what's built (Phase 1) accurately. The Zone A/B distinction is clear, and the GitRemote decoupling (server is just a URL) is the right architectural instinct. The "Impossible States" table is a good forcing function.

Nine concerns follow. Ordered by severity.

---

## 1. MemoryRoot has no identity — only a path

**The problem:** A MemoryRoot is identified by its filesystem path. If a path changes (symlink, mount point, different device), it becomes a different MemoryRoot. This conflates "where on disk" with "what it is."

The same agent's memory on Thor and X220 are logically the same entity but have identical paths (`~/.pi/agents/alph/memory/`). The model can't distinguish "same memory on different device" from "different memory on same device."

**Impact:** When we add GitRemote with push/pull, two devices pushing to the same server are operating on the same logical memory. But the model has no way to express this — each is a separate MemoryRoot with the same path but no shared identity.

**Fix:** Add an `agent_id` to MemoryRoot (Zone A) or a `project_name` (Zone B). The path is a property of the root, not its identity. Two MemoryRoots with the same `agent_id` on different devices are the same logical entity.

---

## 2. SyncPolicy ownership is contradictory

**The problem:** The text says "SyncPolicy is per MemoryRoot, not global." But the ER diagram shows `GitRemote ||--o| SyncPolicy : "governed by"` — implying SyncPolicy belongs to GitRemote, not MemoryRoot.

If I have two remotes (origin and backup), do they share one policy or have independent policies? Do I push to origin on every write but to backup only on /endwork? The model can't answer this.

**Fix:** Decide. Either:
- SyncPolicy is per MemoryRoot (simple: one push policy for all remotes), or
- SyncPolicy is per GitRemote (flexible: different remotes, different push cadences)

The current model says one thing in text and another in the diagram. Pick one and make both consistent.

---

## 3. "No merge conflicts" invariant is too optimistic

**The problem:** The model states: "Push is fire-and-forget — no merge conflicts in single-file markdown memory." This is true for additive single-file writes in Phase 1. But Phase 2 introduces:

- **Deletion** (archival model: "Deleting a document removes all its chunks")
- **Multi-file atomicity** (eventually we'll want transactions across files)
- **Directory restructuring** (adding `archive/`, moving files between subtrees)

If device A deletes `reference/bttn/old-doc.md` and device B writes to the same file, git will flag a conflict on push. "Last push wins" isn't a strategy — it's data loss.

**Fix:** Scope the invariant honestly. "No merge conflicts" is true for the current single-file-write pattern. For Phase 2, we need either: (a) a conflict resolution strategy, or (b) restrict deletion to local-only operations. I'd recommend (b) for now — archival deletion is local, not synced.

---

## 4. Document/Chunk is over-modeled

**The problem:** We're modeling a vector search index as if it were a relational schema. Document → Chunk → Embedding with immutable chunks and cascade deletes. But chunks and embeddings are implementation details of the embedder — they're derived data, not domain entities.

The real entity is: "I have a document. I want to search it semantically." The chunking strategy, embedding dimension, and index format are engineering decisions, not data model concerns.

Over-modeling risks: the model prescribes architecture (chunks must be immutable, ~500 chars, 384 dimensions) before we've validated the heaven-search pattern works for memory files. What if sentence-transformers performs better with different chunk sizes? What if we switch to a different embedder that uses 768 dimensions?

**Fix:** Reduce to two entities: `ArchivalDocument` (content + metadata) and `VectorIndex` (rebuilt from documents). Document → VectorIndex is a derived relationship, not a stored one. The index is an artifact, not an entity. Tools are `memory_archive_store()` and `memory_archive_search()`. How chunks work is an implementation detail behind those tools.

---

## 5. GitRemote's `AuthConfig` is a black box

**The problem:** `AuthConfig` is referenced as a property type but never defined. Is it SSH keys? A credential helper? An API token? A username/password tuple?

This matters because auth failures are a real runtime scenario. If a `memory_write` triggers an auto-push and auth fails, what happens? The model says "Push never blocks a write — if push fails, write still succeeds locally." But it doesn't say what happens to the failure — is it logged? Surfaces as a notification? Retried?

**Fix:** Define AuthConfig minimally: `{ method: "ssh" | "token" | "credential_helper", value?: string }`. Add an invariant: "Push failures are non-blocking and logged. The agent is notified on next session start if local commits exist that haven't been pushed."

---

## 6. MemoryFile has no version/lifecycle model

**The problem:** Git preserves full history, but the memory system only exposes the current tip. `memory_read()` can't access historical versions. Yet the VMA mentions "history, blame, rollback" as benefits of git backing.

Phase 2 features (sync, archival) will produce scenarios where an agent wants to answer "what did this file say before I synced?" or "show me what changed."

**Fix:** Either add version to the model (`MemoryFileVersion` with `commit_hash` and `timestamp`) or explicitly exclude it. "History is available via `git log` but not exposed through memory tools" is a valid scoping decision — just make it explicit.

---

## 7. Agent is not an entity

**The problem:** The agent name is implicit — buried in the MemoryRoot path for Zone A (`~/.pi/agents/<name>/memory/`). But the Session entity references `agent_name` as a property. Multiple agents sharing memory (the deferred multi-agent ACLs) can't be reasoned about without an Agent entity.

With Telegram bots on the horizon, we'll have one agent identity (Alph) accessed via multiple interfaces. The model should represent this.

**Fix:** Add a minimal Agent entity: `{ name: string, memory_root: MemoryRoot }`. Session has a reference to Agent. This is a one-line addition that future-proofs for multi-agent.

---

## 8. Session doesn't model interface source

**The problem:** Session has `agent_name` but no `source` or `interface` field. After headless agent research, we confirmed the Telegram bot will use `--session-id telegram-alph`. The model says cross-interface session state is "deferred" — but we just made architectural commitments that depend on session isolation by interface.

If San is in Pi TUI (`session-id: interactive-main`) and also talking via Telegram (`session-id: telegram-alph`), they're two sessions with the same `agent_name`. The model should acknowledge this pattern.

**Fix:** Add `interface` to Session: `{ agent_name, interface: "tui" | "telegram" | "slack" | "rpc", memory_root, project_path }`. This costs nothing and documents the multi-interface reality we've already designed for.

---

## 9. Memory server discovery is unmodeled

**The problem:** GitRemote has a URL, but how does that URL get configured? The model says the extension doesn't "know" about pi-memory-server — but it needs to know where to push. Is the URL:
- Hardcoded in a config file?
- Set via `memory_remote_add` tool?
- Discovered via environment variable?
- Registered at `/agent:init` time?

This isn't a data model question — it's an interface question. But the model should at minimum note where the configuration boundary is.

**Fix:** Add a note: "GitRemote configuration is stored in `<MemoryRoot>/.git/config` (standard git remote). Management via `memory_remote_add`/`memory_remote_remove` tools. Discovery via `git remote -v` on session start."

---

## Summary

| # | Concern | Severity | Fix cost |
|---|---------|----------|----------|
| 1 | MemoryRoot no identity beyond path | High | Add `agent_id`/`project_name` |
| 2 | SyncPolicy ownership contradictory | Medium | Pick one, make consistent |
| 3 | "No merge conflicts" undermodeled | Medium | Scope to additive writes only |
| 4 | Document/Chunk over-modeled | Medium | Reduce to Document + derived index |
| 5 | AuthConfig undefined | Low | Define minimal type |
| 6 | MemoryFile no version model | Low | Explicitly scope out |
| 7 | Agent not an entity | Low | Add one-line entity |
| 8 | Session has no interface field | Low | Add `interface` property |
| 9 | GitRemote discovery unmodeled | Low | Add configuration note |

**Bottom line:** The model is solid on Phase 1. Phase 2 needs #1 (identity) resolved before we can model sync correctly, and #2 (policy ownership) resolved before we define GitRemote tools. The rest are refinements. The over-modeling of Document/Chunk (#4) should be simplified before we reach Gate 3 (implementation) or we'll build unnecessary complexity into the archival API.
