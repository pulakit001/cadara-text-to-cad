import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";

const SKILL_ROOT = process.resourcesPath && !process.defaultApp
  ? path.join(process.resourcesPath, "cad-runtime")
  : path.resolve(import.meta.dirname, "..", "cad-runtime");

async function resolvePython() {
  const configured = process.env.CAD_PYTHON;
  const bundledPython = process.platform === "win32"
    ? path.join(SKILL_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(SKILL_ROOT, ".venv", "bin", "python");
  const candidates = [
    configured,
    bundledPython,
    path.join(os.homedir(), ".agents", "skills", "cad", ".venv", "bin", "python"),
    path.join(SKILL_ROOT, ".venv", "bin", "python"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(
    "No Python interpreter found. Set CAD_PYTHON in .env to a Python 3.11+ with build123d installed."
  );
}

function run(cmd, args, { cwd, timeoutMs = 300000, env = {}, signal = null }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let canceled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    // Canceling a job kills the geometry build immediately instead of
    // leaving the kernel crunching until its 5-minute timeout.
    const onCanceled = () => {
      canceled = true;
      child.kill("SIGKILL");
    };
    if (signal) {
      if (signal.aborted) onCanceled();
      else signal.addEventListener("abort", onCanceled);
    }

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCanceled);
      resolve({ code, stdout, stderr, timedOut, canceled: canceled || signal?.aborted === true });
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

export async function generatePart({ name, pythonSource, modelsRoot, overwrite = false, signal = null }) {
  const baseSlug = slugify(name);
  const { slug, dir } = overwrite
    ? { slug: baseSlug, dir: path.join(modelsRoot, baseSlug) }
    : await uniqueDirForSlug(modelsRoot, baseSlug);
  await fs.mkdir(dir, { recursive: true });

  const sourcePath = path.join(dir, "part.py");
  await fs.writeFile(sourcePath, pythonSource, "utf8");

  const stepPath = path.join(dir, "part.step");
  const glbPath = path.join(dir, "part.glb");
  const stlPath = path.join(dir, "part.stl");

  const python = await resolvePython();
  const stepScript = path.join(SKILL_ROOT, "scripts", "step");
  const inspectScript = path.join(SKILL_ROOT, "scripts", "inspect");

  const built = await run(python, [
    stepScript,
    sourcePath,
    "--force",
    "--glb",
    path.basename(glbPath),
    "--stl",
    path.basename(stlPath),
  ], { cwd: dir, signal });

  const log = {
    exitCode: built.code,
    timedOut: built.timedOut,
    stdout: built.stdout.trim().slice(0, 4000),
    stderr: built.stderr.trim().slice(0, 6000),
  };

  if (built.canceled) {
    return {
      ok: false,
      canceled: true,
      slug,
      stepPath,
      log,
      error: "canceled",
    };
  }

  if (built.timedOut) {
    return {
      ok: false,
      slug,
      stepPath,
      log,
      error: "Geometry build timed out (5 min). Simplify the model or split it into steps.",
    };
  }

  const stepOk = built.code === 0 && (await fileExists(stepPath));

  if (!stepOk) {
    return {
      ok: false,
      slug,
      stepPath,
      log,
      error:
        "The build123d source failed to generate a STEP file. Fix the code using the error below and retry.",
    };
  }

  const viewerGlb = path.join(dir, ".part.step.glb");
  const inspected = await run(python, [
    inspectScript,
    "refs",
    path.basename(stepPath),
    "--facts",
  ], { cwd: dir, signal });

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

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_cad",
      description:
        "Write build123d Python source for a STEP-ready part, build it, and return the result with geometry facts. Use this for every part generation.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short lowercase part name, e.g. 'mounting-bracket'.",
          },
          python_source: {
            type: "string",
            description:
              "Complete Python module with a single gen_step() function returning one STEP-ready Solid or labeled Compound.",
          },
        },
        required: ["name", "python_source"],
        additionalProperties: false,
      },
    },
  },
];
