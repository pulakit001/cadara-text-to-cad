import fs from "node:fs";
import path from "node:path";

const MAX_HISTORY = 12;

// The session is persisted to disk so the current design (and its history)
// survives app restarts; follow-up "modify" prompts keep their context and
// the UI can reopen the last chat on launch.
export class CadSession {
  constructor(persistPath = null) {
    this.persistPath = persistPath;
    this.current = null;
    this.history = [];
    this.load();
  }

  load() {
    if (!this.persistPath) return;
    try {
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        if (Array.isArray(data.history)) this.history = data.history;
        if (data.current && typeof data.current === "object") this.current = data.current;
      }
    } catch {
      // Missing or corrupt file: start fresh rather than crash.
    }
  }

  persist() {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify({ current: this.current, history: this.history }), "utf8");
    } catch {
      // Persistence is best-effort; a failed write must not break a run.
    }
  }

  snapshot() {
    if (!this.current) return null;
    return {
      current: this.current,
      history: this.history.slice(-MAX_HISTORY),
    };
  }

  record({ prompt, result, summary, routing }) {
    if (!result?.ok || !result.artifacts) return;
    const entry = {
      prompt,
      summary,
      routing,
      recordedAt: new Date().toISOString(),
      slug: result.artifacts.slug,
      dir: result.artifacts.dir,
      sourcePath: result.artifacts.sourcePath,
      pythonSource: result.artifacts.pythonSource,
      facts: result.artifacts.facts,
      stepPath: result.artifacts.stepPath,
      glbPath: result.artifacts.glbPath,
      stlPath: result.artifacts.stlPath,
      viewerGlb: result.artifacts.viewerGlb,
    };
    this.current = entry;
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    this.persist();
  }

  // Reinstates a saved entry (e.g. a chat reopened from history) as the
  // current design so modify-mode follow-ups have full context.
  restore(entry) {
    if (!entry || typeof entry !== "object" || !entry.pythonSource) return false;
    this.current = {
      prompt: entry.prompt || "",
      summary: entry.summary || "",
      recordedAt: entry.recordedAt || new Date().toISOString(),
      slug: entry.slug,
      dir: entry.dir,
      sourcePath: entry.sourcePath,
      pythonSource: entry.pythonSource,
      facts: entry.facts ?? null,
      stepPath: entry.stepPath,
      glbPath: entry.glbPath,
      stlPath: entry.stlPath,
      viewerGlb: entry.viewerGlb,
    };
    this.persist();
    return true;
  }

  clear() {
    this.current = null;
    this.history = [];
    this.persist();
  }
}

export function compactDesignContext(sessionSnapshot) {
  const current = sessionSnapshot?.current;
  if (!current) return "";

  const facts = current.facts ? JSON.stringify(current.facts).slice(0, 5000) : "null";
  const source = current.pythonSource || "";
  const history = (sessionSnapshot.history || [])
    .slice(-4)
    .map((item, index) => `${index + 1}. ${item.prompt} -> ${item.slug}`)
    .join("\n");

  return `CURRENT CAD DESIGN
Slug: ${current.slug}
Previous user request: ${current.prompt}
Previous summary: ${current.summary || ""}
Facts JSON: ${facts}

Recent design history:
${history || "(none)"}

CURRENT CAD SOURCE
\`\`\`python
${source}
\`\`\``;
}
