// Cadara test environment — headless build harness.
//
// Replicates agent/tools.mjs generatePart() byte-for-byte in behavior:
// same python resolution, same `scripts/step` + `scripts/inspect` CLIs,
// same result shape (ok / slug / dir / artifacts / facts / log) — minus the
// LLM stages. The model (an LLM or a human) supplies the build123d source
// directly; everything downstream is identical to the app.
//
// Usage:
//   import { generatePart } from "./build.mjs";
//   const r = await generatePart({ name: "v12-engine", pythonSource });

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.resolve(HERE, "..", "cad-runtime");
export const DEFAULT_MODELS_ROOT = path.resolve(HERE, "..", "models");

function standalonePython(root) {
  return process.platform === "win32"
    ? path.join(root, "python-dist", "python.exe")
    : path.join(root, "python-dist", "bin", "python3");
}

async function resolvePython() {
  const venvDir = process.platform === "win32" ? "Scripts" : "bin";
  const venvExe = process.platform === "win32" ? "python.exe" : "python";
  const candidates = [
    process.env.CAD_PYTHON,
    standalonePython(SKILL_ROOT),
    path.join(os.homedir(), ".agents", "skills", "cad", ".venv", "bin", "python"),
    path.join(SKILL_ROOT, ".venv", venvDir, venvExe),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(
    "No Python interpreter found. Set CAD_PYTHON to a Python 3.11+ with build123d installed."
  );
}

async function runtimeEnv() {
  const env = { PYTHONIOENCODING: "utf-8" };
  const pylibs = path.join(SKILL_ROOT, "pylibs");
  if (await fileExists(pylibs)) env.PYTHONPATH = pylibs;
  return env;
}

function run(cmd, args, { cwd, timeoutMs = 300000, env = {} }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function slugify(text, fallback = "part") {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDirForSlug(modelsRoot, baseSlug) {
  let slug = baseSlug;
  let dir = path.join(modelsRoot, slug);
  for (let i = 2; await fileExists(dir); i++) {
    slug = `${baseSlug}-v${i}`;
    dir = path.join(modelsRoot, slug);
  }
  return { slug, dir };
}

export async function generatePart({ name, pythonSource, modelsRoot = DEFAULT_MODELS_ROOT }) {
  const baseSlug = slugify(name);
  const { slug, dir } = await uniqueDirForSlug(modelsRoot, baseSlug);
  await fs.mkdir(dir, { recursive: true });

  const sourcePath = path.join(dir, "part.py");
  await fs.writeFile(sourcePath, pythonSource, "utf8");

  const stepPath = path.join(dir, "part.step");
  const glbPath = path.join(dir, "part.glb");
  const stlPath = path.join(dir, "part.stl");

  const python = await resolvePython();
  const stepScript = path.join(SKILL_ROOT, "scripts", "step");
  const inspectScript = path.join(SKILL_ROOT, "scripts", "inspect");

  const t0 = Date.now();
  const built = await run(python, [
    stepScript,
    sourcePath,
    "--force",
    "--glb",
    path.basename(glbPath),
    "--stl",
    path.basename(stlPath),
  ], { cwd: dir, env: await runtimeEnv() });

  const log = {
    exitCode: built.code,
    timedOut: built.timedOut,
    elapsedMs: Date.now() - t0,
    stdout: built.stdout.trim().slice(0, 4000),
    stderr: built.stderr.trim().slice(0, 6000),
  };

  if (built.timedOut) {
    return { ok: false, slug, stepPath, log, error: "Geometry build timed out (5 min)." };
  }

  if (!(built.code === 0 && (await fileExists(stepPath)))) {
    return {
      ok: false,
      slug,
      stepPath,
      log,
      error: "The build123d source failed to generate a STEP file.",
    };
  }

  const viewerGlb = path.join(dir, ".part.step.glb");
  const inspected = await run(python, [
    inspectScript,
    "refs",
    path.basename(stepPath),
    "--facts",
  ], { cwd: dir, env: await runtimeEnv() });

  let facts = null;
  if (inspected.code === 0) {
    try {
      const parsed = JSON.parse(inspected.stdout);
      facts = parsed.tokens?.[0]?.summary ?? null;
      if (parsed.tokens?.[0]?.entryFacts) {
        facts.entryFacts = parsed.tokens[0].entryFacts;
      }
    } catch {
      facts = null;
    }
  }

  return {
    ok: true,
    slug,
    dir,
    sourcePath,
    pythonSource,
    stepPath,
    glbPath,
    stlPath,
    viewerGlb,
    facts,
    log,
  };
}
