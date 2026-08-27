#!/usr/bin/env node
// Cadara test environment — build one or all demo parts and print the same
// events the app emits ([status]/[agent]/[artifact] + final result).
//
//   node run.mjs            # build every part in parts/
//   node run.mjs v12-engine # build a single part

import fs from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePart, DEFAULT_MODELS_ROOT } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARTS_DIR = path.join(HERE, "parts");

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fileSize(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

function printArtifact(r) {
  console.log(`[artifact] ${r.stepPath}`);
  console.log(`[artifact]   facts: ${JSON.stringify(r.facts)}`);
}

function printResult(name, r) {
  console.log(`\n=== RESULT: ${name} ===`);
  console.log("ok:", r.ok, "| slug:", r.slug);
  if (!r.ok) {
    console.log("error:", r.error);
    console.log("stderr tail:", (r.log?.stderr || "").split("\n").slice(-6).join("\n"));
    return;
  }
  console.log("step:", r.stepPath, `(${fmtSize(fileSize(r.stepPath))})`);
  console.log("glb :", r.glbPath, `(${fmtSize(fileSize(r.glbPath))})`);
  console.log("stl :", r.stlPath, `(${fmtSize(fileSize(r.stlPath))})`);
  const s = r.facts || {};
  const ef = s.entryFacts || {};
  if (Array.isArray(ef.size)) {
    console.log(
      `size: ${ef.size.map((v) => Math.round(v * 10) / 10).join(" x ")} mm` +
        (ef.volume != null ? ` | volume: ${Math.round(ef.volume)} mm^3` : "") +
        (s.solids != null ? ` | solids: ${s.solids}` : "") +
        (s.faces != null ? ` | faces: ${s.faces}` : "")
    );
  }
}

async function main() {
  const only = process.argv[2];
  let files = await fs.readdir(PARTS_DIR);
  files = files.filter((f) => f.endsWith(".py"));
  if (only) files = files.filter((f) => path.basename(f, ".py") === only);
  if (!files.length) {
    console.error(`No matching parts in ${PARTS_DIR}`);
    process.exit(1);
  }

  console.log(`Cadara test environment → models root: ${DEFAULT_MODELS_ROOT}\n`);
  const results = [];
  for (const f of files) {
    const name = path.basename(f, ".py");
    console.log(`[status] Building "${name}" via cad-runtime…`);
    const pythonSource = await fs.readFile(path.join(PARTS_DIR, f), "utf8");
    const t0 = Date.now();
    const r = await generatePart({ name, pythonSource });
    if (r.ok) printArtifact(r);
    printResult(name, r);
    results.push(r);
    console.log(`[status] "${name}" done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`=== SUMMARY: ${okCount}/${results.length} parts built ===`);
  for (const r of results) {
    const size = r.facts?.entryFacts?.size;
    console.log(
      `  ${r.ok ? "OK  " : "FAIL"} ${r.slug}` +
        (size ? ` — ${size.map((v) => Math.round(v * 10) / 10).join(" x ")} mm` : "")
    );
  }
  if (okCount !== results.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
