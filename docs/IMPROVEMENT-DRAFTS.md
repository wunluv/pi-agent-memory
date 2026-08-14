# Improvement Drafts — pi-agent-memory

> Draft implementations for the five gaps in [design-critique-2026-08](../.memory/reference/pi-agent-memory/design-critique-2026-08.md).
> Constraint honored throughout: **Node built-ins only, zero npm dependencies** (per AGENTS.md). No vector DB, no heavy Python.
> These are drafts — none are wired into `index.ts` yet. Integration points are marked for each.

---

## 1. Ranked retrieval (BM25) — the centerpiece

Replace substring grep in `memory_search` with proper ranked retrieval. BM25 is the standard baseline: term frequency + inverse document frequency + length normalization. It needs no dependencies, no index build step, and no embeddings — it's pure arithmetic over the tokenized corpus.

### 1.1 New module: `ranked-search.ts`

```ts
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Tokenization ────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the","a","an","and","or","but","for","nor","of","to","in","on","at",
  "with","this","that","is","are","was","were","be","been","being","it",
  "its","as","by","from","not","you","we","they","i","he","she",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Light suffix-strip stemmer. Trade-off: recall over precision, no deps.
 * Upgrade path: Porter2 (~100 lines, still dep-free) if merge collisions hurt.
 * Note: BM25 works fine on raw tokens too — stemming is optional.
 */
function stem(t: string): string {
  let s = t;
  if (s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.endsWith("ingly")) s = s.slice(0, -5);
  else if (s.endsWith("edly")) s = s.slice(0, -4);
  else if (s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.endsWith("edly")) s = s.slice(0, -4);
  else if (s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.endsWith("ly")) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

// ─── Levenshtein (for optional fuzzy expansion) ──────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchHit {
  path: string;          // relative to root
  score: number;         // BM25 + boosts (higher = more relevant)
  importance: number;    // 1-5 from frontmatter
  updated: string;       // YYYY-MM-DD from frontmatter
  snippet: string;       // context window around first match
  matchedTerms: string[];// stemmed terms that hit
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function daysSince(isoDate: string, now = Date.now()): number {
  if (!isoDate) return 365; // unknown age → treat as old
  const d = Date.parse(isoDate + "T00:00:00Z");
  if (isNaN(d)) return 365;
  return Math.max(0, (now - d) / 86_400_000);
}

// ─── Core ────────────────────────────────────────────────────────────────────

const K1 = 1.5;  // term-frequency saturation
const B = 0.75;  // length normalization

export interface RankedSearchOptions {
  topN?: number;          // default 10
  recencyHalfLife?: number; // days over which recency boost halves; default 180
  fuzzy?: boolean;        // expand query with near-miss vocab terms; default true
  fuzzyMaxDist?: number;  // default 2
}

/**
 * Rank documents in `root` against `query`.
 * `collectMdFiles` and `parseFrontmatter` are expected to be passed in
 * (they currently live in index.ts) so this module stays testable in isolation.
 */
export function rankedSearch(
  query: string,
  root: string,
  deps: {
    collectMdFiles: (dir: string) => string[];
    parseFrontmatter: (content: string) => { description: string; importance: number; tags: string[]; created: string; updated: string; body: string };
  },
  opts: RankedSearchOptions = {},
): SearchHit[] {
  const { collectMdFiles, parseFrontmatter } = deps;
  const topN = opts.topN ?? 10;
  const recencyHalfLife = opts.recencyHalfLife ?? 180;
  const fuzzy = opts.fuzzy ?? true;
  const fuzzyMaxDist = opts.fuzzyMaxDist ?? 2;

  const files = collectMdFiles(root);
  if (files.length === 0) return [];

  // Load + tokenize corpus
  const docs = files.map((f) => {
    const rel = path.relative(root, f);
    const content = fs.readFileSync(f, "utf-8");
    const fm = parseFrontmatter(content);
    return {
      rel,
      body: fm.body,
      tokens: tokenize(fm.body).map(stem),
      importance: fm.importance,
      updated: fm.updated,
    };
  });

  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;

  // Document frequency per term (for IDF)
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const idf = (term: string): number => {
    const n = df.get(term) ?? 0;
    if (n === 0) return 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  // Query terms, with optional fuzzy expansion against corpus vocabulary
  let qTerms = [...new Set(tokenize(query).map(stem))];
  if (fuzzy && qTerms.length > 0) {
    const vocab = [...df.keys()];
    const expansions: string[] = [];
    for (const qt of qTerms) {
      if (qt.length < 4) continue; // short terms are too noisy to fuzz
      for (const v of vocab) {
        if (v.length >= 4 && Math.abs(v.length - qt.length) <= fuzzyMaxDist && levenshtein(qt, v) <= fuzzyMaxDist) {
          expansions.push(v);
        }
        if (expansions.length > 200) break; // bound the expansion
      }
    }
    qTerms = [...new Set([...qTerms, ...expansions])];
  }

  const results: SearchHit[] = [];

  for (const d of docs) {
    // term frequencies in this doc
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    const matchedTerms: string[] = [];

    for (const qt of qTerms) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const idfVal = idf(qt);
      if (idfVal === 0) continue;
      const tfNorm = (f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.tokens.length / avgdl)));
      score += idfVal * tfNorm;
      matchedTerms.push(qt);
    }

    if (score === 0) continue;

    // Metadata boosts: importance 1-5 → 0.7..1.3 ; recency → halves over half-life
    const importanceBoost = 1 + (d.importance - 3) * 0.15;
    const recencyBoost = Math.pow(0.5, daysSince(d.updated) / recencyHalfLife);
    score *= importanceBoost * (0.5 + recencyBoost); // floor so old docs aren't zeroed

    results.push({
      path: d.rel,
      score,
      importance: d.importance,
      updated: d.updated,
      snippet: makeSnippet(d.body, qTerms),
      matchedTerms,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

/** Window of context around the first matched term. */
function makeSnippet(body: string, qTerms: string[]): string {
  const lower = body.toLowerCase();
  let best = -1;
  for (const t of qTerms) {
    const i = lower.indexOf(t);
    if (i !== -1) best = best === -1 ? i : Math.min(best, i);
  }
  const clean = body.replace(/\s+/g, " ").trim();
  if (best === -1) return clean.slice(0, 160);
  const start = Math.max(0, best - 60);
  const end = Math.min(clean.length, best + 100);
  return (start > 0 ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : "");
}
```

### 1.2 Integration point — replace `memory_search` body in `index.ts`

```ts
async execute(_toolCallId, params) {
  const root = resolveMemoryRoot(params.root);
  if (!root) return { content: [{ type: "text", text: "No active agent and no session root." }], details: {} };

  const hits = rankedSearch(params.query, root, { collectMdFiles, parseFrontmatter }, { topN: 10 });

  if (hits.length === 0) {
    return { content: [{ type: "text", text: "No matches found." }], details: { query: params.query } };
  }

  const text = hits
    .map((h, i) =>
      `${i + 1}. ${h.path}  (score ${h.score.toFixed(2)}, ★${h.importance}, ${h.updated})\n   "${h.snippet}"`)
    .join("\n\n");

  return { content: [{ type: "text", text }], details: { query: params.query, hits: hits.map((h) => h.path) } };
}
```

**Also bump the tool description** to: "Ranked full-text search (BM25 + importance/recency). Returns top matches with snippets."

**Trade-offs to note:**
- BM25 is keyword-based, not semantic. "freeze dryer" won't match "lyophilizer." That's what Phase 2's `VectorIndex` (already in DATA-MODEL) is for. This is the *intermediate* step that makes `memory_search` actually useful today, without pulling in embeddings.
- Tokenization drops non-ASCII and punctuation. Fine for prose; revisit if San's corpus ever needs CJK.

---

## 2. Backlinks — make the graph real

Today `memory_read` returns forward `[[links]]` only. Add a reverse index computed lazily at read time (zero persistent state, always fresh).

### 2.1 New helper in `index.ts`

```ts
/**
 * Find files that link TO the given path. Normalizes wiki-link forms:
 *   "reference/heavencrm/status"  (no .md)
 *   "reference/heavencrm/status.md"
 *   "heavencrm/status"            (relative, unresolved — best-effort suffix match)
 */
function findBacklinks(targetRel: string, root: string): string[] {
  const targetNoExt = targetRel.replace(/\.md$/, "");
  const backlinks: string[] = [];

  for (const f of collectMdFiles(root)) {
    const rel = path.relative(root, f);
    if (rel === targetRel) continue;
    let content: string;
    try {
      content = fs.readFileSync(f, "utf-8");
    } catch {
      continue;
    }
    const body = parseFrontmatter(content).body;
    for (const link of extractWikiLinks(body)) {
      const normalized = link.split("|")[0].trim().replace(/\.md$/, "");
      if (
        normalized === targetNoExt ||
        normalized === targetRel.replace(/\.md$/, "") ||
        normalized.endsWith("/" + targetNoExt) ||
        targetNoExt.endsWith("/" + normalized)
      ) {
        backlinks.push(rel);
        break; // one hit per file is enough
      }
    }
  }
  return backlinks;
}
```

### 2.2 Integration — append to `memory_read` output

In `memory_read.execute`, after `formatWikiLinks(links)`:

```ts
const backlinks = findBacklinks(params.path, root);
const backlinkText = backlinks.length
  ? "\n\n\u2B05 referenced by:\n" + backlinks.map((b) => `  \u2190 ${b}`).join("\n")
  : "";

return {
  content: [{ type: "text", text: content + linkText + backlinkText }],
  details: { path: params.path, links, backlinks, description: fm.description, importance: fm.importance },
};
```

This turns "what links here" into a one-call traversal, and the agent can walk the graph both directions without guessing paths.

---

## 3. Deterministic project registry — kill the regex scraping

The `/startwork .` bug (issue #1) is a symptom of resolving project names by substring-scanning prose. Fix in two layers:

### 3.1 Immediate fix — strict parser over `projects.md`

Only enter name lookup for **bare tokens** (no `.`, `..`, `/`, `\`, `~`), and match the `**Name**` header, not arbitrary line text.

```ts
function isPathLike(input: string): boolean {
  return (
    input === "." ||
    input === ".." ||
    input.startsWith("/") ||
    input.startsWith("~") ||
    input.startsWith(".") ||
    input.includes("/") ||
    input.includes("\\")
  );
}
```

Rewrite the fallback in `startwork`:

```ts
// Resolve as a path always.
let resolvedPath = input.startsWith("/") || input.startsWith("~")
  ? input.replace(/^~/, os.homedir())
  : path.resolve(input);
let memoryPath = path.join(resolvedPath, ".memory");

// Name lookup ONLY for bare tokens, and only if the path didn't exist.
if (!fs.existsSync(memoryPath) && !isPathLike(input)) {
  const entry = findProjectEntry(input); // see below
  if (entry) {
    resolvedPath = entry.path;
    memoryPath = path.join(entry.path, ".memory");
  }
}

if (!fs.existsSync(memoryPath)) {
  ctx.ui.notify(
    `.memory/ not found at ${resolvedPath}. Run /memory:init first, or check the path.`,
    "warning",
  );
  return;
}
```

`findProjectEntry` parses `projects.md` structurally:

```ts
interface ProjectEntry { name: string; path: string }

function findProjectEntry(name: string): ProjectEntry | null {
  const agentRoot = getAgentMemoryRoot();
  if (!agentRoot) return null;
  const projectsFile = path.join(agentRoot, "system", "projects.md");
  if (!fs.existsSync(projectsFile)) return null;

  const body = parseFrontmatter(fs.readFileSync(projectsFile, "utf-8")).body;
  const target = name.toLowerCase();

  let current: ProjectEntry | null = null;

  for (const line of body.split("\n")) {
    // New project entry starts with "- **Name**"
    const headerMatch = line.match(/^\s*-\s*\*\*(.+?)\*\*/);
    if (headerMatch) {
      const headerName = headerMatch[1].split("/")[0].trim();
      if (current && current.name.toLowerCase() === target) return current;
      current = { name: headerName, path: "" };
    }
    // First backtick path on a continuation line under the current entry
    if (current && !current.path) {
      const pathMatch = line.match(/`([^`]+)`/);
      if (pathMatch) {
        const p = pathMatch[1].replace(/^~/, os.homedir());
        if (p.includes("/") || p.startsWith(os.homedir())) current.path = p;
      }
    }
  }
  if (current && current.name.toLowerCase() === target) return current;
  return null;
}
```

This still treats `projects.md` as the human-facing source of truth but matches names exactly and only picks the *first path-looking* backtick, not the first backtick of any kind.

### 3.2 Target state — `registry.json`

If lookup speed or determinism matters, add a machine-readable registry at `~/.pi/agents/<agent>/memory/registry.json`, kept in sync whenever a project is added:

```json
{
  "heavencrm": { "path": "~/DEV/Heaven/heavencrm" },
  "heaven":   { "path": "~/DEV/Heaven" },
  "bttn":     { "path": "~/Projects/BTTN" }
}
```

`findProjectEntry` then checks `registry.json` first, `projects.md` parser second. The JSON is authoritative for resolution; `projects.md` stays prose for humans. A `/memory:register <name> <path>` command writes it (avoids the parser entirely).

---

## 4. Consolidation — the decay/compression loop

This is the conceptual fix. Policy, not just code.

### 4.1 Three lifecycles

| Tier | Files | Lifecycle | Cap |
|------|-------|-----------|-----|
| **Identity** | `system/persona.md`, `system/human/identity.md`, `system/human/preferences.md` | Human-curated, near-constant | Hard token cap (~400) |
| **Operational** | `reference/<proj>/status.md` | Overwrite-in-place; `## Current` churns, `## History` is append-only and compressed | `## History` rolls at 20 entries |
| **Knowledge** | `reference/<proj>/decisions|observations`, `_meta/` | Append, then consolidate into insights | Per-file soft cap, merged by topic |

The substrate stays markdown; only the *access pattern and decay rule* differ.

### 4.2 `consolidateSession()` — run on `/endwork`

```ts
/**
 * Fold this session's raw observations into durable form.
 * 1. Move stale ## Current entries to ## History in touched status.md files.
 * 2. Cap ## History at HISTORY_MAX, summarizing oldest into one line.
 * 3. Flag (don't delete) reference files older than STALE_DAYS with importance < 3
 *    by prepending a "STALE" marker to description for human review.
 */
async function consolidateSession(sessionRoot: string) {
  // (1) status.md churn — agent supplies touched files via args, or derive from git log
  const touched = gitChangedFiles(sessionRoot); // git diff --name-only HEAD~1..HEAD

  for (const rel of touched.filter((f) => f.endsWith("status.md"))) {
    const full = path.join(sessionRoot, rel);
    const content = fs.readFileSync(full, "utf-8");
    const { body } = parseFrontmatter(content);
    const updated = rollHistory(body, 20);
    writeMemoryFile(rel, regenerateFrontmatter(content, updated), sessionRoot);
  }

  // (2) decay sweep
  for (const f of collectMdFiles(sessionRoot)) {
    const content = fs.readFileSync(f, "utf-8");
    const fm = parseFrontmatter(content);
    if (fm.importance < 3 && daysSince(fm.updated) > 180 && !fm.description.startsWith("[STALE]")) {
      const newContent = content.replace(
        /^description: "(.+)"/,
        'description: "[STALE] $1"',
      );
      writeMemoryFile(path.relative(sessionRoot, f), newContent, sessionRoot);
    }
  }

  git(["add", "-A"], sessionRoot);
  git(["commit", "-m", `consolidate: session roll + decay sweep`], sessionRoot);
}
```

`rollHistory` moves `## Current` bullets older than one session into `## History`, keeps the newest 20 history entries, and folds the rest into a single `> Earlier history summarized…` line.

### 4.3 `/remember` — stop transcribing, start distilling

Replace the keyword-bucket of raw text with a two-pass shape:

1. **Extract** — collect this session's assistant messages (as today).
2. **Distill** — before writing, collapse to 1-3 lines each, and *merge into existing* `_meta/` files by tag rather than appending new dated files forever.

The current implementation writes `session-YYYY-MM-DD.md` files indefinitely. The fix: append to `_meta/observations/<topic>.md` (topic = first tag), so related observations accumulate in one file instead of fanning out. Distillation quality is the agent's job; the tool just needs to *merge, not scatter*.

---

## 5. Lifecycle cap for `system/` — stop the unbounded injection

`buildSystemContext()` currently injects every `system/*.md` wholesale. Add a cap so Zone A stays ~800 tokens regardless of growth.

### 5.1 Modification

```ts
const ZONE_A_TOKEN_BUDGET = 900; // rough: ~4 chars/token

function buildSystemContext(): string {
  const sysDir = getSystemDir();
  if (!sysDir || !fs.existsSync(sysDir)) return "";

  const files = collectMdFiles(sysDir);
  if (files.length === 0) return "";

  // Sort: highest importance first, then most recently updated
  const ranked = files
    .map((f) => ({ f, fm: parseFrontmatter(fs.readFileSync(f, "utf-8")) }))
    .sort((a, b) => (b.fm.importance - a.fm.importance) || (daysSince(a.fm.updated) - daysSince(b.fm.updated)));

  const sections: string[] = [];
  let budget = ZONE_A_TOKEN_BUDGET;

  for (const { f, fm } of ranked) {
    const relPath = path.relative(path.join(getAgentMemoryRoot()!, "system"), f);
    const text = `\n=== system/${relPath} ===\n${fm.body.trim()}`;
    const cost = Math.ceil(text.length / 4);
    if (cost > budget) break; // stop injecting once budget exhausted
    sections.push(text);
    budget -= cost;
  }

  const systemInstructions = loadPrompt("system", fallbackSystemPrompt);
  return `<memory_system>\n\n${systemInstructions}\n${sections.join("\n")}\n</memory_system>`;
}
```

**Effect:** identity (importance 5) always in; large/low-importance files get cut first when the budget is tight. This is progressive disclosure applied *within* the pinned tier, not just below it. Files cut from injection remain reachable via `memory_tree`/`memory_read`.

---

## Order of work (recommended)

1. **#3.1 (startwork fix)** — smallest, closes issue #1, removes a correctness bug. Do first.
2. **#1 (BM25 search)** — highest leverage; makes retrieval actually useful. Self-contained module, testable.
3. **#2 (backlinks)** — trivial, immediately makes the graph navigable.
4. **#5 (system/ cap)** — prevents cold-start token creep as memory grows.
5. **#4 (consolidation)** — the conceptual work; lands last because it needs the others' metadata (importance/recency) to decay against.

## Open questions for San

- **Semantic vs keyword:** do you want BM25 now and Phase-2 `VectorIndex` later, or go straight to embeddings? BM25 is the cheap 80%; embeddings are the semantic 20% that handles paraphrase. My call: BM25 now, embeddings when retrieval quality actually hurts.
- **Consolidation agency:** should `/endwork` auto-run consolidation, or should it *propose* changes and ask you to confirm (human-in-the-loop per your methodology)? I lean propose-first for the first few sessions, then auto as trust builds.
- **Registry authority:** keep `projects.md` as source-of-truth with a strict parser, or make `registry.json` authoritative? The former is less machinery; the latter is deterministic.
