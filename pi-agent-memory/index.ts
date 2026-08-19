/**
 * Pi Agent Memory System — Extension (v4)
 *
 * Three-zone git-backed markdown memory with progressive disclosure.
 * Zone A (agent memory): system/ files auto-injected into context.
 * Zone B (project memory): .memory/ directories, session-scoped via /startwork.
 * Zone C (sessions): Pi-managed, accessed via memory_recall/super_sessions.
 *
 * See SPEC_v4.md for full design.
 */

import type { ExtensionAPI, ToolInfo } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as cp from "node:child_process";
import { rankedSearch } from "./ranked-search";
import { extractWikiLinks, findBacklinks } from "./backlinks";
import {
	budgetSystemInjection,
	DEFAULT_TOKEN_BUDGET,
	rankSystemFiles,
	type SystemFileEntry,
} from "./context-budget";

// ─── Constants ───────────────────────────────────────────────────────────────────

const AGENTS_DIR = path.join(os.homedir(), ".pi", "agents");
const ACTIVE_FILE = path.join(AGENTS_DIR, "active");
const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");
const PROMPTS_DIR = path.join(__dirname, "prompts");

// ─── State ────────────────────────────────────────────────────────────────────────

let activeAgent: string | null = null;
let sessionMemoryRoot: string | null = null;

// ─── Prompt Loading ───────────────────────────────────────────────────────────────

/** Load a prompt from file, falling back to a hardcoded default. */
function loadPrompt(name: string, fallback: string): string {
	try {
		const filePath = path.join(PROMPTS_DIR, `${name}.md`);
		if (fs.existsSync(filePath)) {
			return fs.readFileSync(filePath, "utf-8");
		}
	} catch {
		// fall through to fallback
	}
	return fallback;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function loadActiveAgent(): string | null {
	try {
		if (fs.existsSync(ACTIVE_FILE)) {
			return fs.readFileSync(ACTIVE_FILE, "utf-8").trim() || null;
		}
	} catch {
		// ignore
	}
	return null;
}

function saveActiveAgent(name: string) {
	fs.mkdirSync(AGENTS_DIR, { recursive: true });
	fs.writeFileSync(ACTIVE_FILE, name, "utf-8");
}

function getAgentMemoryRoot(): string | null {
	if (!activeAgent) return null;
	return path.join(AGENTS_DIR, activeAgent, "memory");
}

/** Resolve which memory root to use. Session root takes priority, then agent root. */
function resolveMemoryRoot(rootOverride?: string): string | null {
	if (rootOverride) {
		// Expand ~ to home directory so agents can use ~/DEV/... in root params
		const expanded = rootOverride.startsWith("~") ? path.join(os.homedir(), rootOverride.slice(1)) : rootOverride;
		return expanded;
	}
	if (sessionMemoryRoot) return sessionMemoryRoot;
	return getAgentMemoryRoot();
}

function getSystemDir(): string | null {
	const root = getAgentMemoryRoot();
	return root ? path.join(root, "system") : null;
}

/** True if the token looks like a filesystem path rather than a bare name. */
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

interface ProjectEntry {
	name: string;
	path: string;
}

/**
 * Look up a project by name in system/projects.md. Matches the "**Name**"
 * header exactly (case-insensitive), then reads the first path-looking backtick
 * token on a continuation line. Does NOT substring-match over prose — the
 * caller must exclude path-like inputs first (see isPathLike).
 */
function findProjectEntry(name: string): ProjectEntry | null {
	const agentRoot = getAgentMemoryRoot();
	if (!agentRoot) return null;
	const projectsFile = path.join(agentRoot, "system", "projects.md");
	if (!fs.existsSync(projectsFile)) return null;

	const body = parseFrontmatter(fs.readFileSync(projectsFile, "utf-8")).body;
	const target = name.toLowerCase();

	let current: ProjectEntry | null = null;

	for (const line of body.split("\n")) {
		// A new project entry begins with "- **Name**"
		const headerMatch = line.match(/^\s*-\s*\*\*(.+?)\*\*/);
		if (headerMatch) {
			if (current && current.name.toLowerCase() === target) return current;
			current = { name: headerMatch[1].split("/")[0].trim(), path: "" };
			continue;
		}
		// First path-looking backtick token on a continuation line under the entry
		if (current && !current.path) {
			const pathMatch = line.match(/`([^`]+)`/);
			if (pathMatch) {
				const p = pathMatch[1].replace(/^~/, os.homedir());
				if (p.includes("/") || p.includes("\\")) current.path = p;
			}
		}
	}

	if (current && current.name.toLowerCase() === target) return current;
	return null;
}

/** Recursively collect all .md file paths under a directory */
function collectMdFiles(dir: string): string[] {
	const results: string[] = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== ".git" && !entry.name.startsWith(".")) {
					results.push(...collectMdFiles(full));
				}
			} else if (entry.name.endsWith(".md")) {
				results.push(full);
			}
		}
	} catch {
		// directory doesn't exist
	}
	return results;
}

/** Read a file relative to a memory root */
function readMemoryFile(filePath: string, root: string): string | null {
	const full = path.join(root, filePath);
	try {
		return fs.readFileSync(full, "utf-8");
	} catch {
		return null;
	}
}

/** Write a file relative to a memory root, creating directories as needed */
function writeMemoryFile(filePath: string, content: string, root: string): boolean {
	const full = path.join(root, filePath);
	try {
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, "utf-8");
		return true;
	} catch {
		return false;
	}
}

/** Parse frontmatter from markdown content */
function parseFrontmatter(content: string): {
	description: string;
	importance: number;
	tags: string[];
	created: string;
	updated: string;
	body: string;
} {
	const result = {
		description: "",
		importance: 3,
		tags: [] as string[],
		created: "",
		updated: "",
		body: content,
	};

	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return result;

	const fm = match[1];
	result.body = match[2].trimStart();

	for (const line of fm.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("description:")) {
			result.description = trimmed.slice("description:".length).trim().replace(/^"(.*)"$/, "$1");
		} else if (trimmed.startsWith("importance:")) {
			const val = parseInt(trimmed.slice("importance:".length).trim(), 10);
			if (!isNaN(val)) result.importance = Math.max(1, Math.min(5, val));
		} else if (trimmed.startsWith("tags:")) {
			const arrMatch = trimmed.match(/\[(.*)\]/);
			if (arrMatch) {
				result.tags = arrMatch[1].split(",").map((t) => t.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
			}
		} else if (trimmed.startsWith("created:")) {
			result.created = trimmed.slice("created:".length).trim();
		} else if (trimmed.startsWith("updated:")) {
			result.updated = trimmed.slice("updated:".length).trim();
		}
	}

	return result;
}

/** Generate frontmatter string */
function generateFrontmatter(description: string, tags: string[], importance: number): string {
	const now = new Date().toISOString().split("T")[0];
	const lines = ["---", `description: "${description}"`, `importance: ${importance}`];
	if (tags.length > 0) {
		lines.push(`tags: [${tags.map((t) => `"${t}"`).join(", ")}]`);
	}
	lines.push(`created: ${now}`, `updated: ${now}`, "---\n");
	return lines.join("\n");
}

/** Build a formatted tree view for a directory under a given root */
function buildTreeView(dirPath: string, root: string): string {
	const targetDir = dirPath ? path.join(root, dirPath) : root;

	if (!fs.existsSync(targetDir)) {
		return `Path does not exist: ${dirPath || "."}`;
	}

	const lines: string[] = [];

	function walk(currentDir: string, depth: number) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(currentDir, { withFileTypes: true }).filter(
				(e) => e.name !== ".git" && !e.name.startsWith("."),
			);
		} catch {
			return;
		}

		entries.sort((a, b) => {
			if (a.isDirectory() && !b.isDirectory()) return -1;
			if (!a.isDirectory() && b.isDirectory()) return 1;
			return a.name.localeCompare(b.name);
		});

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			const indent = "  ".repeat(depth);
			const prefix = entry.isDirectory() ? "\u{1F4C1} " : "\u{1F4C4} ";
			const isLast = entry === entries[entries.length - 1];
			const branch = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";

			if (entry.isDirectory()) {
				lines.push(`${indent}${branch}${prefix}${entry.name}/`);
				walk(fullPath, depth + 1);
			} else if (entry.name.endsWith(".md")) {
				const content = fs.readFileSync(fullPath, "utf-8");
				const fm = parseFrontmatter(content);
				const stars = "\u2605".repeat(fm.importance) + "\u2606".repeat(5 - fm.importance);
				const nameNoExt = entry.name.replace(/\.md$/, "");
				if (fm.description) {
					lines.push(`${indent}${branch}${nameNoExt} (${stars}) \u2014 ${fm.description}`);
				} else {
					lines.push(`${indent}${branch}${nameNoExt}`);
				}
			} else {
				lines.push(`${indent}${branch}${entry.name}`);
			}
		}
	}

	walk(targetDir, 0);
	return lines.length > 0 ? lines.join("\n") : "(empty)";
}

/** Format wikilinks for display */
function formatWikiLinks(links: string[]): string {
	if (links.length === 0) return "";
	return "\n\n\u{1F517} [[links]] found:\n" + links.map((l) => `  \u2192 [[${l}]]`).join("\n");
}

/** Format backlinks (files that reference this one) for display */
function formatBacklinks(backlinks: string[]): string {
	if (backlinks.length === 0) return "";
	return "\n\n\u2B05 referenced by:\n" + backlinks.map((b) => `  \u2190 ${b}`).join("\n");
}

// ─── Git Helpers ──────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
	try {
		const result = cp.spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 10000 });
		return {
			stdout: result.stdout || "",
			stderr: result.stderr || "",
			code: result.status ?? 1,
		};
	} catch {
		return { stdout: "", stderr: "git not available", code: 1 };
	}
}

/** Initialize a git repo at the given path */
function initGitRepo(repoPath: string): boolean {
	fs.mkdirSync(repoPath, { recursive: true });
	const r = git(["init"], repoPath);
	if (r.code !== 0) return false;
	git(["config", "user.email", "agent-memory@pi"], repoPath);
	git(["config", "user.name", "Agent Memory"], repoPath);
	return true;
}

/** Commit a file to git in the given memory root */
function gitCommit(filePath: string, message: string, root: string): boolean {
	const relPath = path.relative(root, filePath);
	const add = git(["add", relPath], root);
	if (add.code !== 0) return false;
	const commit = git(["commit", "-m", message], root);
	return commit.code === 0;
}

/** Check if a path is a git repo */
function isGitRepo(repoPath: string): boolean {
	return fs.existsSync(path.join(repoPath, ".git"));
}

/** Search session history */
function searchSessions(query: string): string {
	if (!fs.existsSync(SESSIONS_DIR)) return "No session history found.";

	const results: Array<{ session: string; excerpt: string }> = [];
	const queryLower = query.toLowerCase();

	for (const projDir of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
		if (!projDir.isDirectory()) continue;
		const projPath = path.join(SESSIONS_DIR, projDir.name);

		for (const file of fs.readdirSync(projPath)) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = path.join(projPath, file);
			try {
				const content = fs.readFileSync(filePath, "utf-8");
				const lines = content.split("\n").filter(Boolean);
				for (const line of lines) {
					try {
						const entry = JSON.parse(line);
						if (entry.type !== "message" || !entry.message?.content) continue;

						const textParts: string[] = [];
						const contentArr = Array.isArray(entry.message.content)
							? entry.message.content
							: typeof entry.message.content === "string"
								? [{ type: "text", text: entry.message.content }]
								: [];

						for (const block of contentArr) {
							if (block.type === "text" && typeof block.text === "string") {
								textParts.push(block.text);
							}
						}

						const fullText = textParts.join(" ");
						if (fullText.toLowerCase().includes(queryLower)) {
							const excerpt = fullText.length > 200 ? fullText.slice(0, 200) + "..." : fullText;
							const sessionId = file.replace(/\.jsonl$/, "").slice(-20);
							results.push({
								session: `${projDir.name} / ${sessionId}`,
								excerpt: excerpt.trim(),
							});
							if (results.length >= 20) break;
						}
					} catch {
						// skip unparseable lines
					}
				}
			} catch {
				// skip unreadable files
			}
			if (results.length >= 20) break;
		}
		if (results.length >= 20) break;
	}

	if (results.length === 0) return "No matching sessions found.";

	return results
		.map(
			(r, i) =>
				`${i + 1}. [${r.session}]\n   "${r.excerpt}"`,
		)
		.join("\n\n");
}

// ─── System Context Builder ───────────────────────────────────────────────────────

/** Read the token budget for system/ injection (env-overridable). */
function getTokenBudget(): number {
	const env = process.env.PI_MEMORY_TOKEN_BUDGET;
	if (env) {
		const parsed = parseInt(env, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_TOKEN_BUDGET;
}

/** Build the memory system section injected into every turn */
function buildSystemContext(): string {
	const sysDir = getSystemDir();
	if (!sysDir || !fs.existsSync(sysDir)) return "";

	const files = collectMdFiles(sysDir);
	if (files.length === 0) return "";

	const agentRoot = getAgentMemoryRoot()!;
	const systemRoot = path.join(agentRoot, "system");
	const entries: SystemFileEntry[] = files.map((file) => {
		const content = fs.readFileSync(file, "utf-8");
		const fm = parseFrontmatter(content);
		return {
			relPath: path.relative(systemRoot, file).replace(/\\/g, "/"),
			content: fm.body.trim(),
			importance: fm.importance,
			updated: fm.updated,
		};
	});

	const ranked = rankSystemFiles(entries);
	const { included, omitted } = budgetSystemInjection(ranked, getTokenBudget());

	const sections: string[] = [];

	// Load system instructions (from prompt file or fallback)
	const fallbackSystemPrompt = `## Memory System Instructions

You have a git-backed markdown memory system with two tiers.

**Pinned (always in context):** system/ files below — identity, user, projects.
**Lazy (on demand):** Everything else — loaded via memory_tree/memory_read.

Available tools: memory_tree, memory_read, memory_write, memory_search, memory_recall.`;

	const systemInstructions = loadPrompt("system", fallbackSystemPrompt);
	sections.push(`<memory_system>\n\n${systemInstructions}`);

	// Inject system/ data, budgeted by importance + recency
	for (const f of included) {
		sections.push(`\n=== system/${f.relPath} ===`);
		sections.push(f.content);
	}

	if (omitted.length > 0) {
		sections.push(
			`\n[${omitted.length} system file(s) omitted by token budget: ${omitted
				.map((f) => `system/${f.relPath}`)
				.join(", ")}. Reachable via memory_read().]`,
		);
	}

	sections.push("</memory_system>");
	return sections.join("\n");
}

// ─── Extension Entry Point ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Restore active agent
	activeAgent = loadActiveAgent();

	// ─── Tools ──────────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "memory_tree",
		label: "Memory Tree",
		description:
			"List the memory directory tree with file descriptions and star ratings. Does NOT load file bodies. Pass a path to browse a specific subtree (e.g. 'reference/heavenletters/'). Defaults to memory root.",
		promptSnippet: "Browse memory with descriptions, no content loaded",
		promptGuidelines: [
			"Use memory_tree before memory_read to browse what's available without paying token cost",
			"Pass a project path like 'reference/heavenletters/' to focus on a specific subject",
		],
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({ description: "Subdirectory to browse. Defaults to memory root." }),
			),
			root: Type.Optional(
				Type.String({ description: "Memory root override. Defaults to session root, then agent root." }),
			),
		}),
		async execute(_toolCallId, params) {
			const root = resolveMemoryRoot(params.root);
			if (!root) {
				return {
					content: [{ type: "text", text: "No active agent and no session root. Use /startwork or /agent:switch first." }],
					details: {},
				};
			}
			const tree = buildTreeView(params.path || "", root);
			const zone = sessionMemoryRoot && !params.root ? "Zone B (session)" : params.root ? "Zone B (override)" : "Zone A (agent)";
			return {
				content: [{ type: "text", text: tree }],
				details: { zone, path: params.path || "/" },
			};
		},
	});

	pi.registerTool({
		name: "memory_read",
		label: "Memory Read",
		description:
			"Read the full content of a memory file (including frontmatter). Path is relative to the memory root, e.g. 'system/persona.md' or 'reference/heavenletters/status.md'. Also extracts [[wiki-links]] found in the file.",
		promptSnippet: "Load a specific memory file and its [[links]]",
		parameters: Type.Object({
			path: Type.String({ description: "Path relative to memory root, e.g. 'reference/heavenletters/status.md'" }),
			root: Type.Optional(
				Type.String({ description: "Memory root override. Defaults to session root, then agent root." }),
			),
		}),
		async execute(_toolCallId, params) {
			const root = resolveMemoryRoot(params.root);
			if (!root) {
				return {
					content: [{ type: "text", text: "No active agent and no session root." }],
					details: {},
				};
			}
			const content = readMemoryFile(params.path, root);
			if (content === null) {
				return {
					content: [{ type: "text", text: `File not found: ${params.path}` }],
					details: {},
				};
			}
			const fm = parseFrontmatter(content);
			const links = extractWikiLinks(fm.body);
			const backlinks = findBacklinks(params.path, root, { collectMdFiles });
			const linkText = formatWikiLinks(links);
			const backlinkText = formatBacklinks(backlinks);
			return {
				content: [{ type: "text", text: content + linkText + backlinkText }],
				details: { path: params.path, links, backlinks, description: fm.description, importance: fm.importance },
			};
		},
	});

	pi.registerTool({
		name: "memory_write",
		label: "Memory Write",
		description:
			"Write or edit a memory file. Path is relative to memory root, e.g. 'reference/heavenletters/status.md'. Generates YAML frontmatter with the given description, tags, and importance. Creates directories as needed. Auto-commits to git.",
		promptSnippet: "Write to memory with auto-frontmatter and git commit",
		promptGuidelines: [
			"Use memory_write to persist decisions, observations, feedback, and project references",
			"Always provide a clear description — this is what appears in memory_tree listings",
			"Use semantic wiki-paths like 'reference/heavenletters/status.md' — the path IS the subject taxonomy",
			"Use tags for cross-cutting concerns that span multiple projects",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path relative to memory root, e.g. 'reference/heavenletters/status.md'" }),
			content: Type.String({ description: "Markdown body content (without frontmatter)" }),
			description: Type.String({ description: "Short one-line description. Appears in memory_tree listings." }),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for search and filtering" })),
			importance: Type.Optional(
				Type.Number({ description: "Importance 1-5. Controls star rating in tree view. Default 3." }),
			),
			root: Type.Optional(
				Type.String({ description: "Memory root override. Defaults to session root, then agent root." }),
			),
		}),
		async execute(_toolCallId, params) {
			const root = resolveMemoryRoot(params.root);
			if (!root) {
				return {
					content: [{ type: "text", text: "No active agent and no session root." }],
					details: {},
				};
			}
			const tags = params.tags || [];
			const importance = params.importance ?? 3;
			const frontmatter = generateFrontmatter(params.description, tags, importance);
			const fullContent = frontmatter + params.content;

			const fullPath = path.join(root, params.path);

			// Ensure git repo exists
			if (!isGitRepo(root)) {
				initGitRepo(root);
			}

			if (writeMemoryFile(params.path, fullContent, root)) {
				gitCommit(fullPath, `${params.path}: ${params.description}`, root);
				return {
					content: [{ type: "text", text: `\u2705 Written to ${params.path} and committed.` }],
					details: { path: params.path, description: params.description, importance, tags },
				};
			} else {
				return {
					content: [{ type: "text", text: `\u274C Failed to write ${params.path}` }],
					details: {},
				};
			}
		},
	});

	pi.registerTool({
		name: "memory_search",
		label: "Memory Search",
		description:
			"Ranked full-text search (BM25 + importance/recency boosts) across all memory files. Returns top matches with snippets and scores.",
		promptSnippet: "Ranked full-text search across memory files",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			root: Type.Optional(
				Type.String({ description: "Memory root override. Defaults to session root, then agent root." }),
			),
		}),
		async execute(_toolCallId, params) {
			const root = resolveMemoryRoot(params.root);
			if (!root) {
				return {
					content: [{ type: "text", text: "No active agent and no session root." }],
					details: {},
				};
			}
			const hits = rankedSearch(params.query, root, { collectMdFiles, parseFrontmatter }, { topN: 10 });
			if (hits.length === 0) {
				return {
					content: [{ type: "text", text: "No matches found." }],
					details: { query: params.query },
				};
			}
			const text = hits
				.map((h, i) => `${i + 1}. ${h.path}  (score ${h.score.toFixed(2)}, ★${h.importance}, ${h.updated})\n   "${h.snippet}"`)
				.join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: { query: params.query, hits: hits.map((h) => h.path) },
			};
		},
	});

	pi.registerTool({
		name: "memory_recall",
		label: "Memory Recall",
		description:
			"Search past Pi session conversations for relevant excerpts. Scans session JSONL history across all projects. Returns matching message excerpts with session identifiers.",
		promptSnippet: "Search past session conversations for relevant context",
		parameters: Type.Object({
			query: Type.String({ description: "Search query for session history" }),
		}),
		async execute(_toolCallId, params) {
			const result = searchSessions(params.query);
			return {
				content: [{ type: "text", text: result }],
				details: { query: params.query },
			};
		},
	});

	// ─── Commands ───────────────────────────────────────────────────────────────

	pi.registerCommand("agent:init", {
		description: "Initialize a new agent with memory repo. Usage: /agent:init <name>",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (!name) {
				ctx.ui.notify("Usage: /agent:init <agent-name>", "warning");
				return;
			}

			const agentDir = path.join(AGENTS_DIR, name);
			if (fs.existsSync(agentDir)) {
				ctx.ui.notify(`Agent "${name}" already exists. Delete ${agentDir} to re-init.`, "warning");
				return;
			}

			const memoryRoot = path.join(agentDir, "memory");
			fs.mkdirSync(memoryRoot, { recursive: true });
			initGitRepo(memoryRoot);

			const sysDir = path.join(memoryRoot, "system");
			const humanDir = path.join(sysDir, "human");
			fs.mkdirSync(humanDir, { recursive: true });

			fs.writeFileSync(
				path.join(sysDir, "persona.md"),
				generateFrontmatter("Agent identity, beliefs, and communication discipline", ["persona"], 5) +
					`# Persona

Describe who you are as an agent, your relationship with the user,
your communication style, and any known limitations.

This file is always in context — keep it concise and stable.
`,
			);

			fs.writeFileSync(
				path.join(humanDir, "identity.md"),
				generateFrontmatter("User background, motivations, drives", ["human", "identity"], 4) +
					`# User Identity

What you know about your user — background, motivations, drives.
Captured as they emerge during conversations.

Update this via: memory_write("system/human/identity.md", content, description, ["human","identity"], 4)
`,
			);

			fs.writeFileSync(
				path.join(humanDir, "preferences.md"),
				generateFrontmatter("Communication style, work patterns, AI philosophy", ["human", "preferences"], 4) +
					`# User Preferences

Communication style, work patterns, what they value in AI collaboration.
Learn and update over time.

Update this via: memory_write("system/human/preferences.md", content, description, ["human","preferences"], 4)
`,
			);

			fs.writeFileSync(
				path.join(sysDir, "projects.md"),
				generateFrontmatter("Active projects index", ["projects"], 3) +
					`# Active Projects

List active projects here using [[wiki-links]]:
- [[reference/my-project/status]]
- [[reference/another-project/status]]

Each [[link]] points to a semantic wiki-path under the memory root.
`,
			);

			fs.writeFileSync(
				path.join(memoryRoot, "README.md"),
				`# Agent Memory — ${name}

A git-backed markdown memory system. Two tiers:

## Pinned (always in context)

\`\`\`
system/
├── persona.md        # Who you are, communication discipline
├── human/
│   ├── identity.md   # User background, drives
│   └── preferences.md# Communication style, work patterns
└── projects.md       # Active project index ([[links]])
\`\`\`

Edit these files directly or use \`memory_write()\` via the agent.

## Lazy (loaded on demand)

\`\`\`
<project>/            # Semantic wiki-paths organized by project/domain
├── status.md
├── decisions/
├── observations/
├── feedback/
└── references/

_meta/                # Cross-project concerns
├── observations/
├── feedback/
└── decisions/
\`\`\`

Browse with \`memory_tree()\`, read with \`memory_read()\`, write with \`memory_write()\`.

## Commands

| Command | What it does |
|---------|-------------|
| \`/agent:init <name>\` | Initialize a new agent memory repo |
| \`/agent:switch <name>\` | Switch to a different agent |
| \`/startwork [project]\` | Start project session, set memory root |
| \`/endwork\` | End session, update status, commit |
| \`/memory:init <path>\` | Bootstrap .memory/ in a project dir |
| \`/remember\` | Consolidate session into global memory |
| \`/memory:tree [path]\` | Display memory tree |
| \`/memory:read <path>\` | Read a memory file |
| \`/memory:search <query>\` | Search memory files |
| \`/memory:recall <query>\` | Search session history |

---

*Files written via \`memory_write()\` are automatically committed to git.*
*Full history: \`git log\` inside \`~/.pi/agents/${name}/memory/\`
`,
			);

			git(["add", "-A"], memoryRoot);
			git(["commit", "-m", `init: Agent "${name}" memory system setup`], memoryRoot);

			activeAgent = name;
			saveActiveAgent(name);

			ctx.ui.notify(
				`\u2705 Agent "${name}" initialized. Edit system/ files or use memory_write() to populate memory.`,
				"success",
			);
		},
	});

	pi.registerCommand("agent:switch", {
		description: "Switch active agent context. Usage: /agent:switch <name>",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (!name) {
				try {
					const agents = fs.readdirSync(AGENTS_DIR).filter((f) => f !== "active" && !f.startsWith("."));
					if (agents.length === 0) {
						ctx.ui.notify("No agents found. Use /agent:init <name> to create one.", "info");
						return;
					}
					const chosen = await ctx.ui.select("Select agent:", agents);
					if (!chosen) return;
					activeAgent = chosen;
					saveActiveAgent(chosen);
					ctx.ui.notify(`\u2705 Switched to agent: ${chosen}`, "success");
				} catch {
					ctx.ui.notify("No agents found. Use /agent:init <name> to create one.", "info");
				}
				return;
			}

			const agentDir = path.join(AGENTS_DIR, name);
			if (!fs.existsSync(agentDir)) {
				ctx.ui.notify(`Agent "${name}" not found. Use /agent:init ${name} to create it.`, "warning");
				return;
			}

			activeAgent = name;
			saveActiveAgent(name);
			ctx.ui.notify(`\u2705 Switched to agent: ${name}`, "success");
		},
	});

	pi.registerCommand("remember", {
		description: "Consolidate the current session into global memory. Writes observations to _meta/ paths.",
		handler: async (_args, ctx) => {
			if (!activeAgent) {
				ctx.ui.notify("No active agent. Use /agent:switch or /agent:init first.", "warning");
				return;
			}

			const root = getAgentMemoryRoot()!;
			if (!isGitRepo(root)) {
				initGitRepo(root);
			}

			const branch = ctx.sessionManager.getBranch();
			const recentEntries = branch.slice(-20);

			const observations: string[] = [];
			const decisions: string[] = [];
			const feedback: string[] = [];

			for (const entry of recentEntries) {
				if (entry.type !== "message" || !entry.message?.content) continue;
				if (entry.message.role !== "assistant") continue;

				const contentArr = Array.isArray(entry.message.content) ? entry.message.content : [];
				for (const block of contentArr) {
					if (block.type === "text" && typeof block.text === "string") {
						const text = block.text;
						if (text.length > 50) {
							if (text.toLowerCase().includes("decision") || text.toLowerCase().includes("chose") || text.toLowerCase().includes("selected")) {
								decisions.push(text);
							} else if (text.toLowerCase().includes("feedback") || text.toLowerCase().includes("correct") || text.toLowerCase().includes("stop ")) {
								feedback.push(text);
							} else {
								observations.push(text);
							}
						}
					}
				}
			}

			if (observations.length === 0 && decisions.length === 0 && feedback.length === 0) {
				ctx.ui.notify("No significant content to persist from this session.", "info");
				return;
			}

			const now = new Date().toISOString().split("T")[0];
			const sessionLabel = `session-${now}`;
			const targetDir = "_meta";
			let written = 0;

			if (observations.length > 0) {
				const obsContent = observations.slice(0, 3).map((o, i) => `## Observation ${i + 1}\n\n${o.trim()}\n`).join("\n");
				const obsPath = `${targetDir}/observations/${sessionLabel}.md`;
				writeMemoryFile(obsPath, generateFrontmatter(`Session observations from ${now}`, ["observation", now], 3) + obsContent, root);
				gitCommit(path.join(root, obsPath), `${obsPath}: Session observations from ${now}`, root);
				written++;
			}

			if (decisions.length > 0) {
				const decContent = decisions.slice(0, 2).map((d, i) => `## Decision ${i + 1}\n\n${d.trim()}\n`).join("\n");
				const decPath = `${targetDir}/decisions/${sessionLabel}.md`;
				writeMemoryFile(decPath, generateFrontmatter(`Decisions made on ${now}`, ["decision", now], 4) + decContent, root);
				gitCommit(path.join(root, decPath), `${decPath}: Decisions from ${now}`, root);
				written++;
			}

			if (feedback.length > 0) {
				const fbContent = feedback.slice(0, 2).map((f, i) => `## Feedback ${i + 1}\n\n${f.trim()}\n`).join("\n");
				const fbPath = `${targetDir}/feedback/${sessionLabel}.md`;
				writeMemoryFile(fbPath, generateFrontmatter(`User feedback from ${now}`, ["feedback", now], 5) + fbContent, root);
				gitCommit(path.join(root, fbPath), `${fbPath}: Feedback from ${now}`, root);
				written++;
			}

			ctx.ui.notify(`\u2705 Wrote ${written} memory file(s) from this session to global memory.`, "success");
		},
	});

	// ─── New v4 Commands ────────────────────────────────────────────────────────

	pi.registerCommand("memory:init", {
		description: "Bootstrap .memory/ in a project directory. Usage: /memory:init <path>",
		handler: async (args, ctx) => {
			const targetPath = args.trim();
			if (!targetPath) {
				ctx.ui.notify("Usage: /memory:init <path-to-project>", "warning");
				return;
			}

			const resolvedPath = targetPath.startsWith("/") || targetPath.startsWith("~")
				? targetPath.replace(/^~/, os.homedir())
				: path.resolve(targetPath);

			if (!fs.existsSync(resolvedPath)) {
				ctx.ui.notify(`Path does not exist: ${resolvedPath}`, "warning");
				return;
			}

			const memoryPath = path.join(resolvedPath, ".memory");
			if (fs.existsSync(memoryPath)) {
				ctx.ui.notify(`.memory/ already exists at ${memoryPath}. Delete it first to re-init.`, "warning");
				return;
			}

			// Detect project type: org vs standalone
			let isOrg = false;
			const subProjects: string[] = [];
			try {
				const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
				for (const entry of entries) {
					if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
					const subPath = path.join(resolvedPath, entry.name);
					// Check if sub-dir looks like a project (has package.json or is a git repo)
					if (fs.existsSync(path.join(subPath, "package.json")) || fs.existsSync(path.join(subPath, ".git"))) {
						subProjects.push(entry.name);
					}
				}
				isOrg = subProjects.length >= 2;
			} catch {
				// ignore
			}

			// Create .memory/ structure
			fs.mkdirSync(path.join(memoryPath, "reference"), { recursive: true });
			fs.mkdirSync(path.join(memoryPath, "project_insights", "analyses"), { recursive: true });
			fs.mkdirSync(path.join(memoryPath, "project_insights", "wisdom"), { recursive: true });
			initGitRepo(memoryPath);

			const now = new Date().toISOString().split("T")[0];

			if (isOrg) {
				// Organisation pattern
				const projectName = path.basename(resolvedPath);

				// Index
				const indexContent = `# ${projectName} — Project Index\n\n**Last updated:** ${now}\n\n## Sub-Projects\n\n${
					subProjects.map((sp) => `| ${sp} | Pending | [[reference/${sp}/status]] |`).join("\n")
				}\n\n## Priority Stack\n\n1. TBD\n2. TBD\n3. TBD\n`;
				writeMemoryFile("reference/index.md",
					generateFrontmatter(`${projectName} project index`, ["index", "status"], 5) + indexContent, memoryPath);

				// Strategy stub
				const strategyContent = `# ${projectName} — Strategy\n\n**Last updated:** ${now}\n\n## Current Priorities\n\nTBD\n\n## Dependency Map\n\nTBD\n\n## Revenue / Budget\n\nTBD\n`;
				writeMemoryFile("reference/strategy.md",
					generateFrontmatter(`${projectName} strategy and roadmap`, ["strategy"], 5) + strategyContent, memoryPath);

				// Per-sub-project status stubs
				for (const sp of subProjects) {
					const subDir = path.join(memoryPath, "reference", sp);
					fs.mkdirSync(subDir, { recursive: true });
					const statusContent = `# ${sp} — Status\n\n**Last updated:** ${now}\n\n## Current\n\n- Status pending\n\n## Plan\n\n- TBD\n\n## History\n\n- ${now}: .memory/ initialized\n`;
					writeMemoryFile(`reference/${sp}/status.md`,
						generateFrontmatter(`${sp} project status`, ["status", sp], 4) + statusContent, memoryPath);
				}

				ctx.ui.notify(
					`\u2705 Organisation memory initialized at ${memoryPath}\n` +
					`   Pattern: org with ${subProjects.length} sub-projects\n` +
					`   Created: index.md, strategy.md, ${subProjects.length} status stubs\n` +
					`   Next: edit strategy.md and per-project status docs`,
					"success",
				);
			} else {
				// Standalone pattern
				const projectName = path.basename(resolvedPath);

				// Index
				const indexContent = `# ${projectName}\n\n**Last updated:** ${now}\n\n## Status\n\nSee [[reference/status]]\n\n## Priority Stack\n\n1. TBD\n2. TBD\n3. TBD\n`;
				writeMemoryFile("reference/index.md",
					generateFrontmatter(`${projectName} project index`, ["index", "status"], 5) + indexContent, memoryPath);

				// Status
				const statusContent = `# ${projectName} — Status\n\n**Last updated:** ${now}\n\n## Current\n\n- Status pending\n\n## Plan\n\n- TBD\n\n## History\n\n- ${now}: .memory/ initialized\n`;
				writeMemoryFile("reference/status.md",
					generateFrontmatter(`${projectName} operational status`, ["status"], 4) + statusContent, memoryPath);

				ctx.ui.notify(
					`\u2705 Project memory initialized at ${memoryPath}\n` +
					`   Pattern: standalone\n` +
					`   Created: index.md, status.md\n` +
					`   Next: edit status.md with current state`,
					"success",
				);
			}

			// Initial commit
			git(["add", "-A"], memoryPath);
			git(["commit", "-m", `init: Bootstrap .memory/ for ${path.basename(resolvedPath)}`], memoryPath);
		},
	});

	pi.registerCommand("startwork", {
		description: "Start a work session with project memory. Usage: /startwork [project-name | path]",
		handler: async (args, ctx) => {
			const input = args.trim();

			if (!input) {
				ctx.ui.notify("Usage: /startwork <project-name> or /startwork <path-to-project>", "warning");
				return;
			}

			// Try to resolve as a path first
			let resolvedPath = input.startsWith("/") || input.startsWith("~")
				? input.replace(/^~/, os.homedir())
				: path.resolve(input);

			let memoryPath = path.join(resolvedPath, ".memory");

			// If .memory/ doesn't exist at the path, and the input is a bare
			// project name (not a path), look it up in system/projects.md.
			if (!fs.existsSync(memoryPath) && !isPathLike(input)) {
				const entry = findProjectEntry(input);
				if (entry) {
					resolvedPath = entry.path;
					memoryPath = path.join(entry.path, ".memory");
				}
			}

			if (!fs.existsSync(memoryPath)) {
				ctx.ui.notify(
					`.memory/ not found. Run /memory:init first, or check the path.\n` +
					`Looked at: ${memoryPath}`,
					"warning",
				);
				return;
			}

			// Set session root
			sessionMemoryRoot = memoryPath;

			// Load eagle eye
			const tree = buildTreeView("reference", memoryPath);

			ctx.ui.notify(
				`\u2705 Session root set: ${memoryPath}\n` +
				`\n${tree}\n` +
				`\nWhat are we working on today?`,
				"success",
			);
		},
	});

	pi.registerCommand("endwork", {
		description: "End work session. Updates status docs, commits, clears session root. Usage: /endwork",
		handler: async (_args, ctx) => {
			if (!sessionMemoryRoot) {
				ctx.ui.notify("No active session. Use /startwork first, or /remember for global memory consolidation.", "info");
				return;
			}

			// Check for uncommitted changes and report what was saved
			let commitInfo = "";
			if (isGitRepo(sessionMemoryRoot)) {
				const status = git(["status", "--porcelain"], sessionMemoryRoot);
				const changed = status.stdout.trim();
				if (changed) {
					const now = new Date().toISOString().split("T")[0];
					git(["add", "-A"], sessionMemoryRoot);
					const commit = git(["commit", "-m", `endwork: Session consolidation ${now}`], sessionMemoryRoot);
					if (commit.code === 0) {
						const head = git(["rev-parse", "--short", "HEAD"], sessionMemoryRoot);
						const files = changed.split("\n").filter(Boolean).length;
						commitInfo = `   Committed ${head.stdout.trim()} (${files} file${files === 1 ? "" : "s"}).\n`;
					} else {
						commitInfo = "   Commit failed; changes left in working tree.\n";
					}
				} else {
					commitInfo = "   No changes to commit.\n";
				}
			}

			const root = sessionMemoryRoot;
			sessionMemoryRoot = null;

			ctx.ui.notify(
				`\u2705 Session ended. Memory root cleared.\n` +
				commitInfo +
				`   Project memory at: ${root}\n` +
				`   Remember to run super_sessions weekly for extraction.`,
				"success",
			);
		},
	});

	// ─── Browse Commands ────────────────────────────────────────────────────────

	pi.registerCommand("memory:tree", {
		description: "Display memory tree. Usage: /memory:tree [path]",
		handler: async (args, ctx) => {
			if (!activeAgent && !sessionMemoryRoot) {
				ctx.ui.notify("No active agent or session. Use /startwork or /agent:switch first.", "warning");
				return;
			}
			const root = resolveMemoryRoot();
			if (!root) return;
			const tree = buildTreeView(args.trim(), root);
			ctx.ui.notify(tree.substring(0, 500), "info");
		},
	});

	pi.registerCommand("memory:read", {
		description: "Read a memory file. Usage: /memory:read <path>",
		handler: async (args, ctx) => {
			const filePath = args.trim();
			if (!filePath) {
				ctx.ui.notify("Usage: /memory:read <path>", "warning");
				return;
			}
			if (!activeAgent && !sessionMemoryRoot) {
				ctx.ui.notify("No active agent or session.", "warning");
				return;
			}
			const root = resolveMemoryRoot();
			if (!root) return;
			const content = readMemoryFile(filePath, root);
			if (content === null) {
				ctx.ui.notify(`File not found: ${filePath}`, "warning");
				return;
			}
			const fm = parseFrontmatter(content);
			const links = extractWikiLinks(fm.body);
			const backlinks = findBacklinks(filePath, root, { collectMdFiles });
			const display = content.length > 1000 ? content.slice(0, 1000) + "\n\n...(truncated)..." : content;
			ctx.ui.notify(display, "info");
			if (links.length > 0) {
				ctx.ui.notify(`\u{1F517} Links: ${links.join(", ")}`, "info");
			}
			if (backlinks.length > 0) {
				ctx.ui.notify(`\u2B05 referenced by: ${backlinks.join(", ")}`, "info");
			}
		},
	});

	pi.registerCommand("memory:search", {
		description: "Full-text search memory files. Usage: /memory:search <query>",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /memory:search <query>", "warning");
				return;
			}
			if (!activeAgent && !sessionMemoryRoot) {
				ctx.ui.notify("No active agent or session.", "warning");
				return;
			}
			const root = resolveMemoryRoot();
			if (!root) return;
			const hits = rankedSearch(query, root, { collectMdFiles, parseFrontmatter }, { topN: 5 });
			const result = hits.length === 0
				? "No matches found."
				: hits.map((h, i) => `${i + 1}. ${h.path} (★${h.importance}, ${h.updated})`).join("\n");
			ctx.ui.notify(result.substring(0, 500), "info");
		},
	});

	pi.registerCommand("memory:recall", {
		description: "Search past session history. Usage: /memory:recall <query>",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /memory:recall <query>", "warning");
				return;
			}
			const result = searchSessions(query);
			ctx.ui.notify(result.substring(0, 500), "info");
		},
	});

	// ─── Lifecycle Hooks ────────────────────────────────────────────────────────

	pi.on("before_agent_start", async (event) => {
		if (!activeAgent) return;

		const memoryContext = buildSystemContext();
		if (!memoryContext) return;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + memoryContext,
		};
	});

	pi.on("session_start", async () => {
		activeAgent = loadActiveAgent();
		sessionMemoryRoot = null; // Clear session root on new session
	});
}
