/**
 * memory-audit — the measurement half of the memory maintenance loop (#92).
 *
 * Reads pi session JSONL (Zone C) plus the live memory trees and reports, with
 * no model calls and no writes:
 *
 *   cost      cold-start input tokens per project (first assistant turn usage)
 *   trend     the same, by month
 *   reads     which memory files were read, how often, when last
 *   dead      Zone A files no session ever fetched on demand
 *   repeated  tool signatures seen in >= N distinct sessions
 *   commands  repeated bash signatures with their error counts (rediscovery)
 *   budget    Zone A injection per agent, using context-budget.ts rules
 *
 * Two entry points, one implementation:
 *   - CLI:  node scripts/memory-audit.mjs [--out DIR] [--sessions GLOB]
 *   - tool: import { runAudit, formatSummary } from here (see audit.ts)
 *
 * Zero dependencies. Node built-ins only.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The pinned spine — must stay identical to PINNED_SYSTEM_BASENAMES in
 * context-budget.ts. This file is plain .mjs so it cannot import the TS module;
 * test/audit.test.ts asserts the two agree, and that assertion is the sync
 * mechanism. `projects.md` left the spine in #97 (the index moved to
 * knowledge/projects-active.md), so it is budgeted here like any other file.
 */
export const PINNED = new Set(["identity.md", "persona.md", "index.md"]);
export const DEFAULT_BUDGET = 2400;

const tsv = (rows) => rows.map((r) => r.join("\t")).join("\n") + "\n";
const est = (s) => Math.ceil(s.length / 4);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
const mean = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

/** `--home-wunluv-DEV-Heaven-d5--` → `/home/wunluv/DEV/Heaven/d5` */
function projectOf(dirName) {
	return "/" + dirName.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
}

/** `~/.pi/agent/sessions/--home-wunluv-DEV-pi--` for a cwd. */
export function sessionDirFor(cwd) {
	return "--" + cwd.replace(/^\/|\/$/g, "").replace(/\//g, "-") + "--";
}

function walkFiles(root, skip = [".git", "node_modules", "html"]) {
	const out = [];
	const rec = (dir) => {
		let ents;
		try {
			ents = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of ents) {
			if (skip.includes(e.name)) continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) rec(p);
			else if (e.name.endsWith(".md")) out.push(p);
		}
	};
	rec(root);
	return out;
}

/**
 * Normalise a bash command to a repeatable signature. Takes the LAST command in
 * a chain (after && / ; / ||), drops a leading cd, timeout and sudo, then keeps
 * three tokens. The point is to name the procedure that got rebuilt:
 * `git status`, `gh issue create`, `ssh mojah2`.
 */
export function cmdSignature(cmd) {
	const firstLine = String(cmd || "").split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) || "";
	const last =
		firstLine
			.split(/&&|;|\|\|/)
			.map((x) => x.trim())
			.filter((x) => x && !/^cd\s/.test(x))
			.pop() || firstLine;
	const s = last
		.replace(/["'][^"']*["']/g, "Q")
		.replace(/\/[^\s]*/g, "P")
		.replace(/\b\d+\b/g, "N")
		.replace(/^(sudo|timeout\s+N|nohup)\s+/, "")
		.trim();
	return s.split(/\s+/).filter(Boolean).slice(0, 3).join(" ") || "(empty)";
}

/** Parse the handful of frontmatter fields budgeting needs. */
export function auditFrontmatter(text) {
	const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
	const fm = { importance: 3, updated: "" };
	if (m) {
		for (const line of m[1].split("\n")) {
			const i = line.indexOf(":");
			if (i < 0) continue;
			const k = line.slice(0, i).trim();
			const v = line.slice(i + 1).trim();
			if (k === "importance") fm.importance = Number(v) || 3;
			if (k === "updated") fm.updated = v;
		}
	}
	return { body: m ? text.slice(m[0].length) : text, ...fm };
}

/**
 * Zone A inventory for one agent: what injects, what the budget drops, what it
 * costs. Mirrors `budgetSystemInjection` in context-budget.ts — the numbers must
 * agree, or the report will disagree with the real prompt. Pinned files are
 * exempt; the budgeted pool fills greedily by importance then recency.
 */
export function agentBudget(agentSystemDir, budget = DEFAULT_BUDGET) {
	if (!fs.existsSync(agentSystemDir)) return null;
	const files = walkFiles(agentSystemDir).map((abs) => {
		const { body, importance, updated } = auditFrontmatter(fs.readFileSync(abs, "utf8"));
		return { rel: path.relative(agentSystemDir, abs), body, importance, updated, abs };
	});
	// Total order: importance, then recency, then path. The path tiebreaker keeps
	// this identical to rankSystemFiles in context-budget.ts no matter what order
	// the directory walk produced (#97).
	const rank = (a, b) =>
		b.importance - a.importance ||
		(b.updated || "").localeCompare(a.updated || "") ||
		a.rel.localeCompare(b.rel);
	const pinned = files.filter((f) => PINNED.has(path.basename(f.rel))).sort(rank);
	const budgeted = files.filter((f) => !PINNED.has(path.basename(f.rel))).sort(rank);
	const cost = (f) => est(`\n=== system/${f.rel} ===\n${f.body}`);
	const pinnedTokens = pinned.reduce((n, f) => n + cost(f), 0);
	let used = 0;
	const included = [];
	const omitted = [];
	budgeted.forEach((f, i) => {
		const c = cost(f);
		if (i === 0 || used + c <= budget) {
			used += c;
			included.push({ rel: f.rel, tokens: c });
		} else omitted.push({ rel: f.rel, tokens: c });
	});
	return {
		files,
		pinnedTokens,
		used,
		budget,
		fillPct: Math.round((used / budget) * 100),
		included,
		omitted,
		total: pinnedTokens + used,
	};
}

/**
 * Run the whole measurement.
 *
 * opts.sessionsRoot  ~/.pi/agent/sessions
 * opts.agentsDir     ~/.pi/agents
 * opts.agent         which agent's Zone A to measure (optional)
 * opts.glob          filter session file names, e.g. "2026-10-*"
 * opts.minSessions   recurrence threshold for the signature tables (default 3)
 * opts.budget        Zone A token budget (default 2400)
 */
/**
 * First-turn input tokens across the whole corpus, for the one line of context a
 * scoped run still owes the reader. Stops parsing each file at the first
 * assistant turn, so it costs a fraction of the full pass.
 */
export function portfolioColdStart(sessionsRoot, glob) {
	const fileRe = glob
		? new RegExp("^" + String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$")
		: null;
	const inputs = [];
	let sessions = 0;
	let dirs = [];
	try {
		dirs = fs.readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return null;
	}
	for (const dirName of dirs) {
		let files = [];
		try {
			files = fs.readdirSync(path.join(sessionsRoot, dirName)).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}
		for (const f of files) {
			if (fileRe && !fileRe.test(f)) continue;
			sessions++;
			let lines;
			try {
				lines = fs.readFileSync(path.join(sessionsRoot, dirName, f), "utf8").split("\n");
			} catch {
				continue;
			}
			for (const line of lines) {
				if (!line.trim()) continue;
				let d;
				try {
					d = JSON.parse(line);
				} catch {
					continue;
				}
				if (d.type !== "message" || !d.message || d.message.role !== "assistant") continue;
				const usage = d.message.usage || {};
				if (!usage.input) continue; // match runAudit: first assistant turn WITH usage
				inputs.push(usage.input);
				break;
			}
		}
	}
	const sorted = inputs.sort((a, b) => a - b);
	return { sessions, measured: sorted.length, mean: mean(sorted), p50: pct(sorted, 0.5), p90: pct(sorted, 0.9) };
}

export function runAudit(opts = {}) {
	const sessionsRoot = opts.sessionsRoot || path.join(os.homedir(), ".pi", "agent", "sessions");
	const agentsDir = opts.agentsDir || path.join(os.homedir(), ".pi", "agents");
	const minSessions = Number(opts.minSessions || 3);
	const budget = Number(opts.budget || DEFAULT_BUDGET);
	const glob = opts.glob || "";
	/**
	 * `project` scopes the run to one project's session directories: the audit a
	 * session needs is the audit of the memory it is standing in, not the
	 * portfolio's. The corpus scan stays cheap either way (no model calls), but
	 * reporting 594 sessions when 30 belong to this project invites reading the
	 * wrong number as if it were the local one.
	 *
	 * One thing must NOT be silently scoped: the "never fetched" list. A file
	 * fetched only from another project looks dead here, and a dead-looking file
	 * is an argument for deletion. When scoped, that claim is stated as what it
	 * is — not fetched by THIS project's sessions.
	 */
	const projectFilter = opts.project ? String(opts.project).replace(/\/+$/, "") : "";
	const fileRe = glob
		? new RegExp(
				"^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
			)
		: null;

	const projects = new Map();
	const readHits = new Map();
	const sigSessions = new Map();
	const cmdSessions = new Map();
	const cmdErrors = new Map();
	const heaviest = [];
	const monthly = new Map();
	const sectionSizes = {};

	let dirs = [];
	try {
		dirs = fs
			.readdirSync(sessionsRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return null;
	}

	for (const dirName of dirs) {
		const dir = path.join(sessionsRoot, dirName);
		const proj = projectOf(dirName);
		if (projectFilter && proj !== projectFilter && !proj.startsWith(projectFilter + "/")) continue;
		// Scoped, every matching directory belongs to one project: a session started
		// in a subdirectory is not a second project, and a one-project report should
		// not rank itself against its own subdirectories.
		const projKey = projectFilter || proj;
		if (!projects.has(projKey)) projects.set(projKey, { sessions: 0, inputs: [], last: "", systemDate: "" });
		const m = projects.get(projKey);

		let files = [];
		try {
			files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
		} catch {
			continue;
		}

		for (const f of files) {
			if (fileRe && !fileRe.test(f)) continue;
			m.sessions++;
			const id = `${dirName}/${f}`;
			const sessionDate = f.slice(0, 10);
			let firstIn = null;
			let latestSystem = null;
			const callSig = new Map();

			let lines;
			try {
				lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
			} catch {
				continue;
			}

			for (const line of lines) {
				if (!line.trim()) continue;
				let d;
				try {
					d = JSON.parse(line);
				} catch {
					continue;
				}
				if (d.type !== "message") continue;
				const msg = d.message || {};

				if (msg.role === "system" && msg.sections) latestSystem = msg.sections;

				if (msg.role === "assistant") {
					if (firstIn === null) {
						const usage = msg.usage || {};
						if (usage.input) firstIn = usage.input;
					}
					for (const c of msg.content || []) {
						if (!c || c.type !== "toolCall") continue;
						const a = c.arguments || {};
						const key = `${c.name}:${a.topic || a.agent || ""}`;
						if (!sigSessions.has(key)) sigSessions.set(key, new Set());
						sigSessions.get(key).add(id);

						if (c.name === "memory_read" && a.path) {
							const root = a.root ? String(a.root) : "";
							const p = root ? path.join(root, String(a.path)) : String(a.path);
							if (!readHits.has(p)) readHits.set(p, { hits: 0, sessions: new Set(), last: "" });
							const h = readHits.get(p);
							h.hits++;
							h.sessions.add(id);
							if (sessionDate > h.last) h.last = sessionDate;
						}
						if (c.name === "bash" && a.command) {
							const sig = cmdSignature(a.command);
							if (!cmdSessions.has(sig)) cmdSessions.set(sig, new Set());
							cmdSessions.get(sig).add(id);
							callSig.set(c.id, sig);
						}
					}
				}

				if (msg.role === "toolResult" && msg.isError && callSig.has(msg.toolCallId)) {
					const sig = callSig.get(msg.toolCallId);
					cmdErrors.set(sig, (cmdErrors.get(sig) || 0) + 1);
				}
			}

			if (firstIn) {
				m.inputs.push(firstIn);
				heaviest.push({ session: id, project: projKey, input: firstIn, date: sessionDate });
				if (sessionDate > m.last) m.last = sessionDate;
				const mo = sessionDate.slice(0, 7);
				if (!monthly.has(mo)) monthly.set(mo, []);
				monthly.get(mo).push(firstIn);
			}

			if (latestSystem && m.systemDate <= sessionDate) {
				m.systemDate = sessionDate;
				sectionSizes[projKey] = latestSystem;
			}
		}
	}

	// Zone A, for the requested agent or every agent found.
	const agents = opts.agent
		? [opts.agent]
		: fs.existsSync(agentsDir)
			? fs.readdirSync(agentsDir).filter((a) => fs.existsSync(path.join(agentsDir, a, "memory", "system")))
			: [];
	const budgets = agents.map((a) => {
		const b = agentBudget(path.join(agentsDir, a, "memory", "system"), budget);
		return b ? { agent: a, ...b } : null;
	}).filter(Boolean);

	const dead = [];
	for (const b of budgets) {
		for (const f of b.files) {
			const base = path.basename(f.abs);
			const hit = [...readHits.entries()].find(([p]) => p.endsWith(base) || p === f.abs);
			if (!hit) dead.push({ agent: b.agent, rel: f.rel, tokens: est(f.body) });
		}
	}

	const cost = [...projects.entries()]
		.sort((a, b) => b[1].sessions - a[1].sessions)
		.map(([proj, m]) => {
			const s = [...m.inputs].sort((x, y) => x - y);
			return {
				project: proj,
				sessions: m.sessions,
				measured: s.length,
				mean: mean(s),
				p50: pct(s, 0.5),
				p90: pct(s, 0.9),
				max: s[s.length - 1] || 0,
				last: m.last,
			};
		});

	const allInputs = [...projects.values()].flatMap((m) => m.inputs).sort((a, b) => a - b);

	return {
		scope: {
			project: projectFilter || null,
			portfolio: projectFilter ? portfolioColdStart(sessionsRoot, glob) : null,
		},
		totals: {
			sessions: [...projects.values()].reduce((n, m) => n + m.sessions, 0),
			measured: allInputs.length,
			mean: mean(allInputs),
			p50: pct(allInputs, 0.5),
			p90: pct(allInputs, 0.9),
			max: allInputs[allInputs.length - 1] || 0,
		},
		cost,
		trend: [...monthly.entries()].sort().map(([month, arr]) => {
			const s = [...arr].sort((a, b) => a - b);
			return { month, sessions: s.length, mean: mean(s), p90: pct(s, 0.9) };
		}),
		heaviest: heaviest.sort((a, b) => b.input - a.input).slice(0, 20),
		reads: [...readHits.entries()]
			.sort((a, b) => b[1].hits - a[1].hits)
			.map(([p, h]) => ({ path: p, hits: h.hits, sessions: h.sessions.size, last: h.last })),
		dead,
		repeated: [...sigSessions.entries()]
			.filter(([sig, set]) => set.size >= minSessions && !sig.startsWith("bash:"))
			.sort((a, b) => b[1].size - a[1].size)
			.map(([sig, set]) => ({ signature: sig, sessions: set.size })),
		commands: [...cmdSessions.entries()]
			.filter(([, set]) => set.size >= minSessions)
			.sort((a, b) => b[1].size - a[1].size)
			.map(([sig, set]) => ({ signature: sig, sessions: set.size, errors: cmdErrors.get(sig) || 0 })),
		budgets,
		sections: Object.entries(
			Object.values(sectionSizes)
				.reduce((acc, secs) => {
					for (const [k, v] of Object.entries(secs)) {
						if (typeof v !== "string") continue;
						acc[k] = (acc[k] || 0) + v.length;
					}
					return acc;
				}, {}),
		)
			.map(([section, chars]) => ({ section, chars: Math.round(chars / (Object.keys(sectionSizes).length || 1)) }))
			.sort((a, b) => b.chars - a.chars)
			.map((s) => ({ ...s, tokens: Math.ceil(s.chars / 4) })),
	};
}

/** One-screen plain-language summary, for a tool result or a notify. */
export function formatSummary(a) {
	if (!a) return "No sessions found.";
	const lines = [];
	const t = a.totals;
	const scope = a.scope || { project: null, portfolio: null };
	const scoped = !!scope.project;
	const where = scoped ? "this project" : "all sessions";

	lines.push(
		`Cold start (${where}): mean ${t.mean}, p50 ${t.p50}, p90 ${t.p90}, max ${t.max} tokens over ${t.measured} of ${t.sessions} sessions.`,
	);
	// A scoped run still owes the reader the portfolio number, because a local
	// mean means nothing without knowing whether the local repo is light or heavy.
	if (scoped && scope.portfolio) {
		lines.push(
			`Portfolio for comparison: mean ${scope.portfolio.mean}, p90 ${scope.portfolio.p90} over ${scope.portfolio.measured} sessions. /memory:audit-global for all of it.`,
		);
	}
	const first = a.trend[0];
	const last = a.trend[a.trend.length - 1];
	if (first && last && first.month !== last.month) {
		lines.push(`Trend (${where}): ${first.month} mean ${first.mean} → ${last.month} mean ${last.mean}.`);
	}
	for (const b of a.budgets) {
		lines.push(
			`Zone A ${b.agent}: ${b.total} tokens (pinned ${b.pinnedTokens} + budgeted ${b.used}/${b.budget}, ${b.fillPct}% full)` +
				(b.omitted.length ? ` — OVER BUDGET, evicting ${b.omitted.map((o) => o.rel).join(", ")}` : ""),
		);
	}
	if (a.dead.length) {
		// Scoped, this is a weaker claim and must say so: a file read only from
		// another project looks dead here, and "dead" is an argument for deletion.
		lines.push(
			`Never fetched on demand${scoped ? " by this project's sessions" : ""}: ${a.dead.map((d) => `${d.agent}/system/${d.rel} (${d.tokens} tok)`).join("; ")}`,
		);
	}
	lines.push(
		`Read trail (${where}): ${a.reads.length} distinct paths. Top: ${a.reads.slice(0, 3).map((r) => `${r.path.replace(os.homedir(), "~")} ×${r.hits}`).join(", ")}.`,
	);
	const worst = [...a.commands].sort((x, y) => y.errors - x.errors).slice(0, 3);
	if (worst.length) {
		lines.push(`Repeated procedures, most errors: ${worst.map((c) => `${c.signature} (${c.sessions} sessions, ${c.errors} errors)`).join("; ")}.`);
	}
	if (!scoped) {
		const heavy = a.cost.slice(0, 3);
		if (heavy.length) {
			lines.push(`Heaviest projects: ${heavy.map((c) => `${c.project.replace(os.homedir(), "~")} mean ${c.mean}`).join("; ")}.`);
		}
	}
	return lines.join("\n");
}

/** Write the raw tables next to an audit run. Regenerable; safe to delete. */
export function writeTables(a, outDir) {
	fs.mkdirSync(outDir, { recursive: true });
	const W = (name, content) => fs.writeFileSync(path.join(outDir, name), content);

	W("COST.tsv", tsv([["project", "sessions", "measured", "mean", "p50", "p90", "max", "last"],
		...a.cost.map((c) => [c.project, c.sessions, c.measured, c.mean, c.p50, c.p90, c.max, c.last])]));
	W("COST-TREND.tsv", tsv([["month", "sessions", "mean", "p90"],
		...a.trend.map((t) => [t.month, t.sessions, t.mean, t.p90])]));
	W("COST-HEAVIEST.tsv", tsv([["input_tokens", "date", "project", "session"],
		...a.heaviest.map((h) => [h.input, h.date, h.project, h.session])]));
	W("READS.tsv", tsv([["memory_file", "hits", "sessions", "last_read"],
		...a.reads.map((r) => [r.path.replace(os.homedir(), "~"), r.hits, r.sessions, r.last])]));
	W("REPEAT-SIGNATURES.tsv", tsv([["tool_signature", "sessions"],
		...a.repeated.map((r) => [r.signature, r.sessions])]));
	W("STRAY-COMMANDS.tsv", tsv([["command_signature", "sessions", "errors"],
		...a.commands.map((c) => [c.signature, c.sessions, c.errors])]));
	W("BUDGET.tsv", tsv([["agent", "pinned", "budgeted_used", "budget", "fill_pct", "total", "omitted"],
		...a.budgets.map((b) => [b.agent, b.pinnedTokens, b.used, b.budget, b.fillPct, b.total, b.omitted.map((o) => o.rel).join(",") || "-"])]));
	W("SYSTEM-SECTIONS.tsv", tsv([["section", "chars", "tokens"], ...a.sections.map((s) => [s.section, s.chars, s.tokens])]));
	W("DEAD-A.md", `# Zone A files never fetched on demand\n\n${a.dead.map((d) => `- ${d.agent}/system/${d.rel} (${d.tokens} tok)`).join("\n") || "none"}\n`);
	return outDir;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isCli) {
	const argv = process.argv.slice(2);
	const arg = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
	};
	const out = arg("--out", path.join(process.cwd(), ".memory", "project_insights", "audit"));
	const audit = runAudit({
		glob: arg("--sessions", ""),
		minSessions: arg("--min-sessions", "3"),
		agent: arg("--agent", ""),
		budget: arg("--budget", String(DEFAULT_BUDGET)),
	});
	if (!audit) {
		console.error("No sessions found. Check ~/.pi/agent/sessions.");
		process.exit(1);
	}
	writeTables(audit, out);
	console.log(formatSummary(audit));
	console.log(`\ntables: ${out}`);
}
