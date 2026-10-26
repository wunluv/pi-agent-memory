/**
 * Tests for #97 — the project index moved out of the injected spine.
 *
 * Run with: node test/projects-index.test.ts
 *
 * Two things are asserted, and both are about where a name comes from now that
 * `system/projects.md` is no longer injected:
 *
 *   1. `knowledge/projects-active.md` is read first, and a legacy
 *      `system/projects.md` is still read when the new location is absent —
 *      so a root bootstrapped before #97 keeps resolving without a migration.
 *   2. `/startwork <name>` resolves through the index, which is the whole
 *      reason the file still exists.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { resolveProjectsIndexPath, PROJECTS_INDEX_PATH, LEGACY_PROJECTS_INDEX_PATH } from "../paths.ts";

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

// ─── Part 1: the resolver (pure, no harness) ──────────────────────────────────

await test("knowledge/ wins when both locations exist", () => {
	const root = tmpDir("projindex-both-");
	for (const rel of [PROJECTS_INDEX_PATH, LEGACY_PROJECTS_INDEX_PATH]) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), "# index\n");
	}
	assert.equal(resolveProjectsIndexPath(root), path.join(root, PROJECTS_INDEX_PATH));
});

await test("legacy system/projects.md still resolves (pre-#97 roots)", () => {
	const root = tmpDir("projindex-legacy-");
	fs.mkdirSync(path.join(root, "system"), { recursive: true });
	fs.writeFileSync(path.join(root, LEGACY_PROJECTS_INDEX_PATH), "# index\n");
	assert.equal(resolveProjectsIndexPath(root), path.join(root, LEGACY_PROJECTS_INDEX_PATH));
});

await test("neither location returns null", () => {
	const root = tmpDir("projindex-none-");
	fs.mkdirSync(path.join(root, "system"), { recursive: true });
	assert.equal(resolveProjectsIndexPath(root), null);
});

// ─── Part 2: /startwork resolves through the index ────────────────────────────

const FAKE_HOME = tmpDir("projindex-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");
const CWD = tmpDir("projindex-cwd-");
const PROJECTS_HOME = tmpDir("projindex-projects-");

const KESTREL = path.join(PROJECTS_HOME, "kestrel");
const LEGACY_ONLY = path.join(PROJECTS_HOME, "legacyonly");

fs.mkdirSync(path.join(KESTREL, ".memory"), { recursive: true });
fs.mkdirSync(path.join(LEGACY_ONLY, ".memory"), { recursive: true });
fs.mkdirSync(path.join(AGENT_MEMORY, "knowledge"), { recursive: true });
fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: "00000000-0000-4000-8000-000000000097", name: "testagent" }),
);

// The canonical location: two-line entry shape the parser expects.
fs.writeFileSync(
	path.join(AGENT_MEMORY, PROJECTS_INDEX_PATH),
	["- **Kestrel**", `  \`${KESTREL}\` | memory \`.memory/\``, ""].join("\n"),
);
// A legacy file that must be IGNORED while the canonical one exists.
fs.writeFileSync(
	path.join(AGENT_MEMORY, LEGACY_PROJECTS_INDEX_PATH),
	["- **Legacyonly**", `  \`${LEGACY_ONLY}\` | memory \`.memory/\``, ""].join("\n"),
);

process.env.HOME = FAKE_HOME;

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

const commands: Record<string, any> = {};
const hooks: Record<string, any> = {};
mod.default({
	registerTool: () => {},
	registerCommand: (name: string, def: any) => {
		commands[name] = def;
	},
	on: (event: string, handler: any) => {
		hooks[event] = handler;
	},
});

function mockCtx(notes: Array<{ text: string; level?: string }>) {
	return {
		ui: {
			notify: (text: string, level?: string) => notes.push({ text, level }),
			select: async () => "no",
			confirm: async () => false,
			setStatus: () => {},
			theme: { fg: (_color: string, text: string) => text },
		},
	};
}

process.chdir(CWD);
if (hooks.session_start) await hooks.session_start({}, mockCtx([]));

await test("/startwork resolves a name listed only in knowledge/projects-active.md", async () => {
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler("kestrel", mockCtx(notes));
	const warning = notes.find((n) => n.level === "warning");
	assert.ok(!warning, `resolved without warning: ${JSON.stringify(notes)}`);
});

await test("a legacy entry is not consulted while the canonical index exists", async () => {
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler("legacyonly", mockCtx(notes));
	// If the legacy file were read, this name would resolve and a session would
	// begin. Its absence is the assertion.
	assert.ok(
		!notes.some((n) => n.text.includes("Session root set")),
		`no session began: ${JSON.stringify(notes)}`,
	);
	assert.ok(
		notes.some((n) => n.text.includes("No session started")),
		`reported that nothing started: ${JSON.stringify(notes)}`,
	);
});

console.log("\nall projects-index tests passed");
