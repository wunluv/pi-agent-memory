/**
 * Tests for the Zone A `system/projects.md` fallback lookup and its
 * miss-diagnosis (#65).
 *
 * Run with: node test/project-lookup.test.ts
 *
 * Part 1 covers the pure parse and the two messages. Part 2 loads the real
 * extension (jiti + pi's alias map, same as render.test.ts) and drives the
 * `/startwork` handler against a throwaway HOME, because the defect lives in
 * the caller: an empty entry path made `path.join("", ".memory")` resolve
 * against process cwd.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import {
	findProjectEntryInBody,
	movedProjectMessage,
	pathlessEntryMessage,
} from "../project-lookup.ts";

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

// ─── Part 1: pure parse ────────────────────────────────────────────────────────

const PROJECTS_MD = `# Projects

- **Godwriting** — Late friend's methodology. Promise to take it online.
  Research phase

- **Heavenletters** — Stewardship of the corpus.
  Active | Project root: \`~/DEV/Heaven/\` | Project memory: \`~/DEV/Heaven/.memory/\`

- **MSA / MedStudentAdvisors** — mentoring.
  Active | Project root: \`~/DEV/msa/\`
`;

const HOME = "/home/tester";

await test("a status-only entry parses with an empty path (#65)", () => {
	const entry = findProjectEntryInBody(PROJECTS_MD, "godwriting", HOME);
	assert.ok(entry, "entry found");
	assert.equal(entry.name, "Godwriting");
	assert.equal(entry.path, "", "empty path is preserved, not fabricated");
});

await test("a complete entry parses its path and expands ~", () => {
	const entry = findProjectEntryInBody(PROJECTS_MD, "heavenletters", HOME);
	assert.ok(entry);
	assert.equal(entry.path, path.join(HOME, "DEV/Heaven/"));
});

await test("name match is case-insensitive and the slash-split name survives", () => {
	assert.ok(findProjectEntryInBody(PROJECTS_MD, "GODWRITING", HOME));
	assert.ok(findProjectEntryInBody(PROJECTS_MD, "msa", HOME), "MSA / MedStudentAdvisors matches as MSA");
	assert.equal(findProjectEntryInBody(PROJECTS_MD, "nowhere", HOME), null);
});

await test("a path is only taken from the matched entry, not a later one", () => {
	const entry = findProjectEntryInBody(PROJECTS_MD, "godwriting", HOME);
	assert.equal(entry?.path, "", "Godwriting must not inherit Heavenletters' path");
});

await test("prose backticks without a slash are not treated as a path", () => {
	const body = "- **Thing** — uses `pnpm` and `uv`.\n  Active\n";
	assert.equal(findProjectEntryInBody(body, "thing", HOME)?.path, "");
});

// ─── Part 2: messages ─────────────────────────────────────────────────────────

await test("pathless message names the real cause and the two real fixes", () => {
	const msg = pathlessEntryMessage("godwriting");
	assert.ok(msg.includes('"godwriting"'), msg);
	assert.ok(msg.includes("no project path"), msg);
	assert.ok(msg.includes("Project root:"), msg);
	assert.ok(msg.includes("/startwork <path-to-project>"), msg);
	assert.ok(!msg.includes("registered at ,"), "no empty-path interpolation");
	assert.ok(!msg.includes("may have moved"), "a pathless entry has not moved");
});

await test("moved message still reports the stale path", () => {
	const msg = movedProjectMessage("godwriting", "/old/place");
	assert.ok(msg.includes("registered at /old/place"), msg);
	assert.ok(msg.includes("may have moved"), msg);
});

// ─── Part 3: the /startwork handler, against a throwaway HOME ─────────────────

const FAKE_HOME = tmpDir("projlookup-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");
const CWD = tmpDir("projlookup-cwd-");
const PATHLESS_PROJECT = "godwriting";
const MOVED_PATH = tmpDir("projlookup-moved-");

fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.mkdirSync(path.join(AGENTS_DIR), { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: "00000000-0000-4000-8000-000000000065", name: "testagent" }),
);
fs.writeFileSync(
	path.join(AGENT_MEMORY, "system", "projects.md"),
	[
		`- **Godwriting** — Late friend's methodology.`,
		`  Research phase`,
		``,
		`- **Moved** — points at a stale path.`,
		`  Active | Project root: \`${MOVED_PATH}\``,
		``,
	].join("\n"),
);
// The trap: cwd has its OWN .memory/. `path.join("", ".memory")` resolves to it.
fs.mkdirSync(path.join(CWD, ".memory"), { recursive: true });

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

/** Notifications recorded by a run of a command handler. */
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
if (hooks.session_start) {
	await hooks.session_start({}, mockCtx([]));
}

await test("pathless entry: names the cause and refuses, no cwd-relative adoption", async () => {
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler(PATHLESS_PROJECT, mockCtx(notes));

	const warning = notes.find((n) => n.level === "warning");
	assert.ok(warning, `a warning was raised: ${JSON.stringify(notes)}`);
	assert.ok(warning.text.includes("no project path"), warning.text);
	assert.ok(!warning.text.includes("registered at ,"), "no empty-path interpolation");
	assert.ok(
		!notes.some((n) => n.text.includes("Session root set")),
		`no session began: ${JSON.stringify(notes)}`,
	);
});

await test("stale path: the moved message still appears", async () => {
	const notes: Array<{ text: string; level?: string }> = [];
	await commands.startwork.handler("moved", mockCtx(notes));

	const warning = notes.find((n) => n.level === "warning");
	assert.ok(warning, `a warning was raised: ${JSON.stringify(notes)}`);
	assert.ok(warning.text.includes(`registered at ${MOVED_PATH}`), warning.text);
	assert.ok(warning.text.includes("may have moved"), warning.text);
	assert.ok(!notes.some((n) => n.text.includes("Session root set")), "no session began");
});

console.log("\nall project-lookup tests passed");
