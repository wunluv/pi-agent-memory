import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectSessionDocuments, messageText, searchSessionMessages } from "../session-search.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-search-"));
const project = path.join(root, "promptvault");
fs.mkdirSync(project, { recursive: true });
const session = path.join(project, "session-a.jsonl");
fs.writeFileSync(session, [
  JSON.stringify({ type: "message", message: { role: "user", content: "A prompt came up during an unrelated conversation." } }),
  "this is malformed JSON and must be ignored",
  JSON.stringify({ type: "message", message: { role: "assistant", content: [
    { type: "text", text: "PromptVault protects proprietary prompt assets." },
    { type: "text", text: "The vault can preserve prompt IP." },
  ] } }),
  JSON.stringify({ type: "event", message: { content: "prompt vault" } }),
].join("\n"));

assert.equal(messageText("plain text"), "plain text");
assert.equal(messageText([{ type: "text", text: "one" }, { type: "image", text: "ignored" }, { type: "text", text: "two" }]), "one two");
assert.equal(collectSessionDocuments(root).length, 2, "only valid message entries become documents");

const ranked = searchSessionMessages("prompt vault", root, { topN: 20 });
assert.equal(ranked.length, 2);
assert.match(ranked[0].path, /^promptvault \/ session-a#3$/);
assert.match(ranked[0].snippet.toLowerCase(), /vault/);
assert.deepEqual(searchSessionMessages("prompt vault", root, { topN: 1 }).length, 1, "topN remains bounded");
assert.equal(searchSessionMessages("missing-term", root).length, 0);

console.log("session-search.test.ts — all assertions passed");
