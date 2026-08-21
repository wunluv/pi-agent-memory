> ARCHIVED 2026-08-21 — Letta-era duplicate memory protocol. The canonical, injected protocol
> is `prompts/system.md`. Kept for history; not loaded by the extension. Point, never repeat (#3).

# Memory Access Protocol

**Purpose:** Minimize token waste by loading only what's needed, when it's needed.

## Principles

1. **Scan before loading.** Use `memory_tree` to browse descriptions before touching content. Descriptions are free; file bodies cost tokens.
2. **Start specific, widen only when necessary.** Load the most targeted file first. If Heaven News is the topic, `heavenletters-tasklist.md` has the direct status. Don't also load `heavenletters.md` (architecture, brand, CRM, translations) unless needed.
3. **One file at a time.** Read one file, assess if it's enough, then decide whether to load more. Never batch-read multiple files unless they're explicitly linked and both are clearly relevant.
4. **Use search before load.** When looking for a specific fact ("what's the email server URL?"), use `memory_search` or `bash grep` rather than loading whole files.
5. **Bin before reading.** Before opening a file, state what specific question you expect it to answer. "I need the Heaven News draft status from the tasklist" — then read the tasklist. If the answer isn't there, expand.
6. **Stop at sufficient context.** If you can answer the user's question with what you have, stop loading. Don't pre-load related files "just in case." Trust that you can load more if needed.

## Workflow

```
User asks about X
    → memory_tree(reference/)           # Browse, don't load
    → Identify the single most specific file
    → State what question it answers
    → memory_read(that file only)
    → Can I answer now?
        YES → respond, stop loading
        NO  → memory_read(next most specific file)
```

## Exceptions

- **system/ files** are already in context — no need to re-read them.
- **memories you've already read this session** — no need to re-read.
- **When unsure which file has the answer** — ask the user rather than loading everything.

## What this prevents

- Loading a full project doc for a specific task status
- Pre-loading linked reference files without knowing they're needed
- Reading multiple files "to be thorough" when one would do
- Loading content that turns out to be in a directory listing (archive index), not the files themselves
