/**
 * Tests for the bare `/startwork` root-binding notice (#66).
 *
 * Run with: node test/startwork.test.ts
 *
 * Loads the real extension (jiti + pi's alias map) and drives the command
 * handler, because the defect and the fix both live in the caller: the
 * discovered root, the owner check, and the notify ordering.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

const FAKE_HOME = tmpDir("startwork-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");

fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: "00000000-0000-4000-8000-000000000066", name: "testagent" }),
);
fs.writeFileSync(path.join(AGENT_MEMORY, "system", "projects.md"), "# Projects\n");
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

async function mockCtx(notes: Array<{ text: string; level?: string }>) {
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

/** Bind a fresh session in `cwd` (session_start caches discovery from cwd). */
async function sessionIn(cwd: string) {
	process.chdir(cwd);
	await hooks.session_start({}, await mockCtx([]));
}

/** A project dir with a real .memory/ (minted project.json, so no registry write). */
function projectWithMemory(parent: string, name: string, signals: string[] = []): string {
	const dir = path.join(parent, name);
	fs.mkdirSync(path.join(dir, ".memory"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".memory", "project.json"),
		JSON.stringify({ uuid: `00000000-0000-4000-8000-${name.padEnd(12, "0").slice(0, 12)}` }),
	);
	for (const s of signals) {
		if (s === ".git") fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
		else fs.writeFileSync(path.join(dir, s), "# stub\n");
	}
	return dir;
}

// ─── the incident shape: org root above an un-initialised sub-project ─────────

const TREE = tmpDir("startwork-tree-");
const ORG = projectWithMemory(TREE, "Heaven");
const SUB = path.join(ORG, "godwriting");
fs.mkdirSync(SUB, { recursive: true });
fs.writeFileSync(path.join(SUB, "README.md"), "# godwriting\n");

await test("bare /startwork in a sub-project warns that it walked up, then binds", async () => {
	await sessionIn(SUB);
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler("", await mockCtx(notes));

	const warning = notes.find((n) => n.level === "warning");
	assert.ok(warning, `a warning was raised: ${JSON.stringify(notes.map((n) => n.level))}`);
	assert.ok(warning.text.includes(path.join(ORG, ".memory")), warning.text);
	assert.ok(warning.text.includes(SUB), `names cwd: ${warning.text}`);
	assert.ok(warning.text.includes("walked up"), warning.text);
	assert.ok(warning.text.includes("/startwork ."), `hints at the fix: ${warning.text}`);

	// Warn, never refuse: the ritual still binds (the issue's choice).
	const success = notes.find((n) => n.text.includes("Session root set"));
	assert.ok(success, `session still began: ${JSON.stringify(notes)}`);
	assert.ok(success.text.includes(path.join(ORG, ".memory")), success.text);
});

await test("no warning when cwd owns its own .memory/", async () => {
	await sessionIn(ORG);
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler("", await mockCtx(notes));

	assert.ok(
		!notes.some((n) => n.level === "warning"),
		`no warning for the owning dir: ${JSON.stringify(notes)}`,
	);
	assert.ok(notes.some((n) => n.text.includes("Session root set")), "session began");
});

await test("a plain subdirectory warns without the bootstrap hint", async () => {
	const inner = path.join(ORG, "src");
	fs.mkdirSync(inner, { recursive: true });
	await sessionIn(inner);
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler("", await mockCtx(notes));

	const warning = notes.find((n) => n.level === "warning");
	assert.ok(warning, "warning raised");
	assert.ok(!warning.text.includes("/startwork ."), `no hint without a project signal: ${warning.text}`);
});

await test("explicit /startwork <name> is unaffected by the notice", async () => {
	await sessionIn(SUB);
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler(path.join(ORG, ".memory"), await mockCtx(notes));

	assert.ok(
		!notes.some((n) => n.level === "warning"),
		`explicit path resolves directly: ${JSON.stringify(notes)}`,
	);
});

console.log("\nall startwork tests passed");
