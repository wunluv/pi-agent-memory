/**
 * Scope reporting for read and search results (#73).
 *
 * Memory tools bind their root once per session (see discovery.ts), and that
 * binding is deliberately stable: a mid-session `cd` must never move a
 * destination. The defect was that the binding was invisible at the point of
 * use. A result set did not say which root it came from, so a wrong root looked
 * exactly like a right one — the same silence #65/#66/#69 fixed for writes, and
 * #67 for membership. This module fixes it for reads.
 *
 * Everything here is pure. `resolveScope()` mirrors the resolution ladder and
 * `index.ts` derives its root from it, so what gets reported cannot drift from
 * what was actually used. The renderers are the only place result text is built.
 *
 * Forward-looking: once `memory_search` fans out over a local root and a shared
 * commons (#71), provenance is per hit-group. Grouping by root is already the
 * shape here, so that change inherits this renderer rather than inventing one.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isProjectMemoryRoot, scopeDriftNotice } from "./discovery.ts";

/**
 * The shared commons prefix (#71). A path beginning with this resolves against
 * the org root, whatever the session is bound to, because the commons is not
 * inside any project or agent root. One constant, so the resolver and the
 * search fan-out cannot disagree about the spelling.
 */
export const INSIGHTS_PREFIX = "insights/";

/** Whether a memory path addresses the shared commons. */
export function isInsightsPath(p: string): boolean {
	return p.replace(/\\/g, "/").replace(/^\.\//, "").startsWith(INSIGHTS_PREFIX);
}

/** Why a root won the ladder. The reason is part of what the model needs to know. */
export type ScopeKind = "override" | "insights" | "session" | "discovered" | "agent";

export interface ScopeInput {
	/** `params.root`, with `~` already expanded by the caller. */
	explicitRoot: string | null;
	/** `params.path` for the path-taking tools; drives the commons prefix rule. */
	pathParam?: string | null;
	/**
	 * The shared org layer root. The `insights/` prefix resolves here, and the path
	 * keeps its prefix, so `root` and `params.path` still join to the right file.
	 * Resolving to `<org root>/insights` and keeping the prefix would write to
	 * `insights/insights/…` — the bug this comment exists to prevent.
	 */
	orgRoot?: string | null;
	sessionRoot: string | null;
	autoDiscoveredRoot: string | null | undefined;
	agentRoot: string | null;
	cwd: string;
	home: string;
}

export interface MemoryScope {
	/** Absolute resolved root. The value every caller must use. */
	root: string;
	kind: ScopeKind;
	/** Zone label, matching the vocabulary already used in tool `details`. */
	zone: string;
	/** Plain-language reason this root won. */
	origin: string;
	/** `root` with the home prefix shortened, for result text only. */
	display: string;
	/** Drift line when cwd has left the bound project, else null. */
	drift: string | null;
	/**
	 * Set when the commons prefix rule fired *and* the local root has its own top-level
	 * `insights/` — two places claim the same path, so name both rather than pick silently (#71).
	 */
	conflict: string | null;
}

const ZONE_LABEL: Record<ScopeKind, string> = {
	override: "Zone B (override)",
	insights: "Org (shared commons)",
	session: "Zone B (session)",
	discovered: "Zone B (auto-discovered)",
	agent: "Zone A (agent)",
};

const ORIGIN: Record<ScopeKind, string> = {
	override: "named by the root= parameter",
	insights: "the insights/ prefix addresses the shared commons",
	session: "bound by /startwork",
	discovered: "discovered from cwd at session start",
	agent: "no session root, so the agent root is the fallback",
};

/** Shorten a home-relative path to `~/…`. Display only — never used to resolve. */
export function shortenHome(p: string, home: string): string {
	const h = home.replace(/\/+$/, "");
	if (!h) return p;
	return p === h || p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}

/**
 * Drift is meaningful only for a bound project root.
 *
 * An explicit `root=` is a deliberate choice, so there is nothing to flag. The
 * agent root has no meaningful "inside" (its owner is the agent directory), so
 * reporting drift there would fire on every Zone A read and become noise.
 */
function driftFor(kind: ScopeKind, root: string, cwd: string): string | null {
	if (kind === "override" || kind === "insights" || !isProjectMemoryRoot(root)) return null;
	const base = scopeDriftNotice(root, cwd);
	if (!base) return null;
	// Both audiences are named: the model can pass root=, the human can rebind.
	// Addressing only the tool (#70) or only the human leaves one of them stuck.
	return `${base}\nPass root=<path> for a one-off read elsewhere, or run /startwork <project> to rebind the session.`;
}

/**
 * Two roots claim the same path: the commons won, and the local root has its own
 * top-level `insights/`. The explicit `root` parameter is the way to reach the
 * local one, so say exactly that rather than letting the write land somewhere
 * the author did not intend.
 */
function conflictFor(kind: ScopeKind, localRoot: string | null, orgRoot: string | null): string | null {
	if (kind !== "insights" || !localRoot || !orgRoot) return null;
	const local = path.join(localRoot, INSIGHTS_PREFIX.replace(/\/$/, ""));
	try {
		if (!fs.statSync(local).isDirectory()) return null;
	} catch {
		return null;
	}
	return `A local ${INSIGHTS_PREFIX} also exists at ${local}. This resolved to the shared commons instead; pass root=${localRoot} to reach the local one.`;
}

/**
 * Resolve the active scope, mirroring the ladder in `resolveMemoryRoot`:
 * explicit → commons prefix → session → auto-discovered → agent. Null when
 * nothing resolves.
 */
export function resolveScope(input: ScopeInput): MemoryScope | null {
	const localRoot = input.sessionRoot ?? input.autoDiscoveredRoot ?? null;
	const commons = input.orgRoot && input.pathParam && isInsightsPath(input.pathParam) ? input.orgRoot : null;
	const ladder: Array<[ScopeKind, string | null | undefined]> = [
		["override", input.explicitRoot],
		["insights", commons],
		["session", input.sessionRoot],
		["discovered", input.autoDiscoveredRoot],
		["agent", input.agentRoot],
	];
	const hit = ladder.find(([, root]) => !!root);
	if (!hit) return null;
	const kind = hit[0];
	const root = hit[1] as string;

	// The path-tool scope is the org root, so say which subtree the path addresses.
	const display = kind === "insights"
		? `${shortenHome(root, input.home)} (${INSIGHTS_PREFIX})`
		: shortenHome(root, input.home);

	return {
		root,
		kind,
		zone: ZONE_LABEL[kind],
		origin: ORIGIN[kind],
		display,
		drift: driftFor(kind, root, input.cwd),
		conflict: conflictFor(kind, localRoot, input.orgRoot ?? null),
	};
}

/** One line of provenance, e.g. `scope: Zone B (session) · ~/DEV/x/.memory`. */
export function renderScope(scope: MemoryScope, label = "scope"): string {
	return `${label}: ${scope.zone} · ${scope.display}`;
}

/**
 * The shared commons as a first-class scope, for the search fan-out (#71).
 *
 * A search covers two corpora, and the commons is not a rung of the ladder: it
 * is a second place to look. Giving it the same shape means one renderer labels
 * both, and the commons needs no special case downstream.
 */
export function commonsScope(insightsRoot: string, home: string): MemoryScope {
	return {
		root: insightsRoot,
		kind: "insights",
		zone: ZONE_LABEL.insights,
		origin: ORIGIN.insights,
		display: shortenHome(insightsRoot, home),
		drift: null,
		conflict: null,
	};
}

/** The provenance line plus any drift or conflict warning, ready to append. */
export function renderScopeBlock(scope: MemoryScope, label = "scope"): string {
	const warns = [scope.drift, scope.conflict].filter(Boolean) as string[];
	const warn = warns.map((w) => `\n\u26A0 ${w}`).join("");
	return `\n\n${renderScope(scope, label)}${warn}`;
}

/** Shape handed to tool `details`, so renderers need not re-parse the text. */
export function scopeDetails(scope: MemoryScope): {
	root: string;
	zone: string;
	kind: ScopeKind;
	origin: string;
	drift: boolean;
	conflict: boolean;
} {
	return {
		root: scope.root,
		zone: scope.zone,
		kind: scope.kind,
		origin: scope.origin,
		drift: !!scope.drift,
		conflict: !!scope.conflict,
	};
}
