#!/usr/bin/env node
// Print the app-style facts summary for every built model in models/.
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DEFAULT_MODELS_ROOT } from "./build.mjs";

const python =
  process.env.CAD_PYTHON ||
  path.join(os.homedir(), ".agents/skills/cad/.venv/bin/python");
const inspect = path.resolve(DEFAULT_MODELS_ROOT, "..", "cad-runtime/scripts/inspect");

const rows = [];
for (const slug of fs.readdirSync(DEFAULT_MODELS_ROOT).sort()) {
  const step = path.join(DEFAULT_MODELS_ROOT, slug, "part.step");
  if (!fs.existsSync(step)) continue;
  let facts = {};
  try {
    const out = execFileSync(python, [inspect, "refs", "part.step", "--facts"], {
      cwd: path.dirname(step),
      encoding: "utf8",
    });
    const token = JSON.parse(out).tokens[0];
    facts = { ...token.summary, entryFacts: token.entryFacts };
  } catch {
    rows.push({ slug, err: true });
    continue;
  }
  const ef = facts.entryFacts || {};
  rows.push({
    slug,
    kind: facts.kind,
    size: (ef.size || []).map((v) => Math.round(v * 10) / 10).join(" x "),
    faces: facts.faceCount,
    shapes: facts.shapeCount,
  });
}

for (const r of rows) {
  if (r.err) {
    console.log(`  ${r.slug}: facts unavailable`);
    continue;
  }
  console.log(
    `  ${r.slug.padEnd(16)} | ${String(r.kind).padEnd(8)} | ${String(r.size).padEnd(22)} mm | ${r.faces} faces | ${r.shapes} shapes`
  );
}
