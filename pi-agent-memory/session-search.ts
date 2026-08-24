/** BM25 retrieval adapter for Pi's read-only Zone C session JSONL corpus. */
import * as fs from "node:fs";
import * as path from "node:path";
import { rankedSearchDocuments, type RankedSearchOptions, type SearchHit, type RankedTextDocument } from "./ranked-search.ts";

/** Extract user-visible text blocks from a Pi message content value. */
export function messageText(content: unknown): string {
  const blocks = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];
  return blocks
    .filter((block): block is { type: string; text: string } =>
      !!block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join(" ")
    .trim();
}

/** Build one searchable document per message, skipping malformed JSONL safely. */
export function collectSessionDocuments(sessionsDir: string): RankedTextDocument[] {
  const documents: RankedTextDocument[] = [];
  if (!fs.existsSync(sessionsDir)) return documents;

  for (const project of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(sessionsDir, project.name);
    for (const file of fs.readdirSync(projectPath, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const filePath = path.join(projectPath, file.name);
      let updated = "";
      try {
        updated = new Date(fs.statSync(filePath).mtimeMs).toISOString().slice(0, 10);
      } catch {
        // Unknown timestamps receive the normal old-document score floor.
      }
      try {
        const lines = fs.readFileSync(filePath, "utf-8").split("\n");
        lines.forEach((line, lineNumber) => {
          if (!line.trim()) return;
          try {
            const entry = JSON.parse(line) as { type?: unknown; message?: { content?: unknown; role?: unknown } };
            if (entry.type !== "message" || !entry.message) return;
            const text = messageText(entry.message.content);
            if (!text) return;
            const session = `${project.name} / ${file.name.replace(/\.jsonl$/, "")}#${lineNumber + 1}`;
            documents.push({
              path: session,
              body: text,
              description: `${project.name} ${entry.message.role === "user" ? "user" : "assistant"}`,
              importance: 3,
              updated,
            });
          } catch {
            // Zone C is append-only and may contain a partial/corrupt line.
          }
        });
      } catch {
        // Skip unreadable session files while preserving the rest of the corpus.
      }
    }
  }
  return documents;
}

export function searchSessionMessages(
  query: string,
  sessionsDir: string,
  opts: RankedSearchOptions = {},
): SearchHit[] {
  return rankedSearchDocuments(query, collectSessionDocuments(sessionsDir), { topN: 20, ...opts });
}
