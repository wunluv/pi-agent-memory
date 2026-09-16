/**
 * #71: the shared insights commons at ~/.pi/org/insights/.
 *
 * Run with: node test/insights-commons.test.ts
 *
 * Drives the real tool handlers through the jiti harness. The point of the suite
 * is that the commons is reachable, searchable and attributed, and that nothing
 * about Zone A injection changed.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

function tmpDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
	return Promise.resolve(fn()).then(
		() => {
			console.log(`ok - ${name}`);
		},
		(err) => {
			console.error(`not ok - ${name}`);
			throw err;
		},
	);
}

const AGENT_UUID = "00000000-0000-4000-8000-000000000071";
const FAKE_HOME = tmpDir("commons-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");
const ORG_ROOT = path.join(FAKE_HOME, ".pi", "org");
const INSIGHTS_ROOT = path.join(ORG_ROOT, "insights");

fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.mkdirSync(ORG_ROOT, { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: AGENT_UUID, name: "testagent" }),
);
fs.writeFileSync(path.join(AGENT_MEMORY, "system", "projects.md"), "# Projects\n");
fs.writeFileSync(path.join(AGENT_MEMORY, "system", "identity.md"), "---\ndescription: \"who\"\n---\nSPINE_MARKER\n");
// Commits must work without a real HOME.
fs.writeFileSync(
	path.join(FAKE_HOME, ".gitconfig"),
	"[user]\n\tname = Test\n\temail = test@example.com\n",
);
process.env.HOME = FAKE_HOME;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const NVM_ROOT = path.dirname(path.dirname(process.execPath));
const JITI_STATIC = path.join(
	NVM_ROOT,
	"lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs",
);
const PI_ROOT = path.join(NVM_ROOT, "lib/node_modules/@earendil-works/pi-coding-agent");
const EXT_DIR = path.dirname(new URL(import.meta.url).pathname) + "/..";

const require = createRequire(path.join(PI_ROOT, "package.json"));
const alias = {
	"@earendil-works/pi-coding-agent": path.join(PI_ROOT, "dist/index.js"),
	"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
	"@mariozechner/pi-coding-agent": path.join(PI_ROOT, "dist/index.js"),
	"@mariozechner/pi-tui": require.resolve("@earendil-works/pi-tui"),
	typebox: require.resolve("typebox"),
	"typebox/compile": require.resolve("typebox/compile"),
	"typebox/value": require.resolve("typebox/value"),
	"@sinclair/typebox": require.resolve("typebox"),
};
const { createJiti } = await import(JITI_STATIC);
const jiti = createJiti(import.meta.url, { alias });
const mod = await jiti.import(path.join(EXT_DIR, "index.ts"));

const tools: Record<string, any> = {};
const hooks: Record<string, any> = {};
mod.default({
	registerTool: (def: any) => {
		tools[def.name] = def;
	},
	registerCommand: () => {},
	on: (event: string, handler: any) => {
		hooks[event] = handler;
	},
});

async function mockCtx() {
	return {
		ui: {
			notify: () => {},
			select: async () => "skip anyway",
			confirm: async () => false,
			setStatus: () => {},
			theme: { fg: (_c: string, text: string) => text },
		},
	};
}

async function sessionIn(cwd: string) {
	process.chdir(cwd);
	await hooks.session_start({}, await mockCtx());
}

async function callTool(name: string, params: Record<string, unknown>) {
	const result = await tools[name].execute("call-1", params);
	return {
		text: result.content.map((c: any) => c.text).join("\n"),
		details: result.details as any,
	};
}

function gitLog(repo: string): string {
	return execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf-8" });
}

// ─── fixtures ────────────────────────────────────────────────────────────────

const TREE = tmpDir("commons-tree-");
const PROJECT = path.join(TREE, "proj");
const PMEM = path.join(PROJECT, ".memory");
fs.mkdirSync(path.join(PMEM, "reference"), { recursive: true });
fs.writeFileSync(path.join(PMEM, "project.json"), JSON.stringify({ uuid: "00000000-0000-4000-8000-0000000000bb" }));
fs.writeFileSync(
	path.join(PMEM, "reference", "tidepools.md"),
	"---\ndescription: \"tidepool survey\"\nimportance: 5\nupdated: 2026-09-16\n---\n# Tidepools\n\nAnemones cluster in the lower intertidal zone.\n",
);
const NOPROJECT = path.join(TREE, "bare");
fs.mkdirSync(NOPROJECT, { recursive: true });

// ─── the reported cases ──────────────────────────────────────────────────────

await test("memory_write('insights/…') lands in the org root and commits to the org repo", async () => {
	await sessionIn(PROJECT);
	const { text } = await callTool("memory_write", {
		path: "insights/tooling/commons-probe.md",
		content: "COMMONS_MARKER: one ranking pass over the union corpus.",
		description: "shared commons probe",
		importance: 4,
	});
	assert.ok(text.includes("insights/tooling/commons-probe.md"), text);

	const written = path.join(INSIGHTS_ROOT, "tooling", "commons-probe.md");
	assert.ok(fs.existsSync(written), `written under the org root: ${written}`);
	assert.ok(!fs.existsSync(path.join(INSIGHTS_ROOT, ".git")), "the commons is not its own repo");
	assert.ok(fs.existsSync(path.join(ORG_ROOT, ".git")), "the org root is the repo");
	assert.ok(gitLog(ORG_ROOT).includes("commons-probe.md"), `committed to org: ${gitLog(ORG_ROOT)}`);
});

await test("memory_read('insights/…') works from a bound project session and names the commons", async () => {
	await sessionIn(PROJECT);
	const { text, details } = await callTool("memory_read", { path: "insights/tooling/commons-probe.md" });
	assert.ok(text.includes("COMMONS_MARKER"), "content returned");
	assert.ok(text.includes("Org (shared commons)"), `scope named: ${text.slice(-200)}`);
	assert.equal(details.kind, "insights");
	assert.equal(details.root, ORG_ROOT, "the org root hosts the path; the prefix stays in the path");
});

await test("the commons resolves even with no session root and no project", async () => {
	await sessionIn(NOPROJECT);
	const { text, details } = await callTool("memory_read", { path: "insights/tooling/commons-probe.md" });
	assert.ok(text.includes("COMMONS_MARKER"), `readable without a project: ${text.slice(0, 200)}`);
	assert.equal(details.kind, "insights");
});

await test("a knowledge/ write still lands in the agent root", async () => {
	// No project in cwd, so the ladder's last rung (agent root) answers.
	await sessionIn(NOPROJECT);
	await callTool("memory_write", {
		path: "knowledge/zone-a-probe.md",
		content: "ZONE_A_MARKER",
		description: "zone a probe",
	});
	assert.ok(fs.existsSync(path.join(AGENT_MEMORY, "knowledge", "zone-a-probe.md")), "Zone A unchanged");
	assert.ok(!fs.existsSync(path.join(INSIGHTS_ROOT, "knowledge")), "not diverted to the commons");
});

await test("memory_search covers both corpora in one pass, grouped and attributed", async () => {
	await sessionIn(PROJECT);
	const { text, details } = await callTool("memory_search", { query: "COMMONS_MARKER" });
	assert.ok(text.startsWith("Searched:"), `header leads: ${text.slice(0, 160)}`);
	assert.ok(text.includes(" + "), `both corpora named: ${text.slice(0, 200)}`);
	assert.ok(text.includes("\u2014 Org (shared commons)"), `group header: ${text.slice(0, 300)}`);
	assert.ok(text.includes("insights/tooling/commons-probe.md"), "shared hit rendered with its prefix");
	assert.ok(text.includes(`by ${"00000000".slice(0, 8)}`), `author attributed: ${text}`);
	assert.equal(details.corpus, "all");
	assert.equal(details.corpora.length, 2);

	// And the union really is one ranking pass: the local corpus alone must not
	// contain the shared document's term.
	// The union really is one pass over both corpora: the local corpus alone has no
	// match for the shared document's term.
	const localOnly = await callTool("memory_search", { query: "COMMONS_MARKER", corpus: "local" });
	assert.ok(localOnly.text.includes("Searched: Zone B (auto-discovered)"), localOnly.text.slice(0, 160));
	assert.ok(localOnly.text.includes("No matches found."), `nothing local matches: ${localOnly.text.slice(0, 160)}`);
	assert.ok(!localOnly.text.includes("insights/tooling/commons-probe.md"), "excluded from the local corpus");
});

await test("corpus filters respect the boundary in both directions", async () => {
	await sessionIn(PROJECT);
	const shared = await callTool("memory_search", { query: "anemones", corpus: "shared" });
	assert.ok(!shared.text.includes("reference/tidepools.md"), `local excluded: ${shared.text.slice(0, 200)}`);

	const both = await callTool("memory_search", { query: "anemones" });
	assert.ok(both.text.includes("reference/tidepools.md"), "local included by default");

	const sharedMissing = await callTool("memory_search", { query: "anemones", corpus: "shared" });
	assert.equal(sharedMissing.details.corpus, "shared");
});

await test("an explicit root overrides the prefix rule, and the conflict is announced", async () => {
	// A project that has its own insights/ tree: two roots claim the same path.
	const localInsights = path.join(PMEM, "insights");
	fs.mkdirSync(localInsights, { recursive: true });
	fs.writeFileSync(path.join(localInsights, "local-probe.md"), "LOCAL_INSIGHTS_MARKER\n");

	await sessionIn(PROJECT);
	const byDefault = await callTool("memory_read", { path: "insights/local-probe.md" });
	assert.ok(byDefault.text.includes("File not found"), "the commons won, and the local file is not there");
	assert.ok(byDefault.text.includes("\u26A0"), `conflict warned: ${byDefault.text}`);
	assert.ok(byDefault.text.includes(localInsights), "names the local tree");

	const local = await callTool("memory_read", { path: "insights/local-probe.md", root: PMEM });
	assert.ok(local.text.includes("LOCAL_INSIGHTS_MARKER"), `explicit root reaches it: ${local.text.slice(0, 200)}`);
	assert.equal(local.details.kind, "override");
});

await test("regression: the commons is never injected into the pinned spine", async () => {
	await sessionIn(PROJECT);
	const result = await hooks.before_agent_start({}, await mockCtx());
	const injected = typeof result === "string" ? result : (result?.systemPrompt ?? JSON.stringify(result ?? ""));
	assert.ok(injected.includes("SPINE_MARKER"), "Zone A system/ files still inject");
	assert.ok(!injected.includes("COMMONS_MARKER"), "the commons does not inject");
});

console.log("\nall insights-commons tests passed");
