const MAX_HISTORY = 12;

export class CadSession {
  constructor() {
    this.current = null;
    this.history = [];
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
  }

  clear() {
    this.current = null;
    this.history = [];
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
