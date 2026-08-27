#!/usr/bin/env node
// Seeds the real Cadara app (Electron userData) with the five test-env
// models so they appear in the app's chat history list with their prompts.
//
// - Copies each model dir into userData/models under the next free slug
//   (same versioning the app uses: slug, slug-v2, ...).
// - Merges history entries into previous-designs.json (existing designs kept).
// - Sets cad-session.json so the app reopens with the hero model loaded.
//
// Run: node seed-history.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODELS_ROOT, generatePart } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA = process.env.CADARA_USERDATA
  || path.join(os.homedir(), "Library", "Application Support", "cadara");
const APP_MODELS = path.join(USER_DATA, "models");
const HISTORY_FILE = path.join(USER_DATA, "previous-designs.json");
const SESSION_FILE = path.join(USER_DATA, "cad-session.json");
const HISTORY_VERSION = 2;

const python =
  process.env.CAD_PYTHON
  || path.join(os.homedir(), ".agents/skills/cad/.venv/bin/python");
const inspect = path.resolve(HERE, "..", "cad-runtime", "scripts", "inspect");

const DEMO = [
  {
    slug: "v12-engine",
    prompt:
      "A 1:8 scale V12 engine display model: two cylinder banks set at a 64 degree V on a 410 mm crankcase, six 52 mm bores per bank spaced evenly along the crank axis, cam covers on top of each bank, an exhaust stub exiting the outer side of every head, twelve individual throttle-body stacks with trumpet lips in the valley, a front crank pulley with alternator pulley and nose, a rear flywheel with ring gear, an oil pan with deeper sump, and four engine mount pads.",
    summary:
      "Built a 1:8 scale V12 engine display model — two 32-degree banks with six 52 mm bores each, cam covers, twelve ITB trumpet stacks in the valley, front pulley drive, rear flywheel, and an oil pan with sump. STEP, GLB and STL exported; overall 492 x 209 x 282 mm.",
  },
  {
    slug: "dc-motor",
    prompt:
      "An industrial DC motor: 100 mm diameter stator body 200 mm long with 14 cooling fins, end bells on both sides, a front mounting flange 124 mm across with four bolt holes, an 8 mm shaft extending 40 mm with a keyway notch on top, a rear fan cowl with eight intake perforations, a terminal box on top with two cable glands and lid screws, a side nameplate, a lifting eyebolt, and two mounting feet with bolt holes.",
    summary:
      "Built an industrial DC motor — 100 mm finned stator body, end bells, a 124 mm flange with four bolt holes, keyed 8 mm shaft, perforated fan cowl, terminal box with glands, nameplate, eyebolt, and bolted mounting feet. STEP, GLB and STL exported; overall 326 x 124 x 162 mm.",
  },
  {
    slug: "studio-speaker",
    prompt:
      "A two-way studio monitor speaker: 220 x 260 x 360 mm cabinet on a wider recessed plinth with four rubber feet, a front baffle recessed behind a border frame, an 8-inch woofer with rubber surround, cone and dust cap inside a trim ring, a waveguide tweeter with a dome, four grille pins in the frame corners, and a rear panel with a flared bass port, six amplifier heatsink fins, and two binding posts.",
    summary:
      "Built a two-way studio monitor — 220 x 260 x 360 mm cabinet on a plinth, border-framed baffle with an 8-inch woofer (surround, cone, dust cap, trim ring), waveguide tweeter with dome, grille pins, and a rear panel carrying a flared bass port, heatsink fins, and binding posts. STEP, GLB and STL exported; overall 230 x 294 x 372 mm.",
  },
  {
    slug: "sports-car",
    prompt:
      "A mid-engine sports car concept, 500 mm long and 210 mm wide: a low wedge body extruded from a side silhouette with a glass canopy, four wheel arch pockets with five-spoke wheels, tires and hub axles, a front splitter, side skirts, four rear diffuser fins, a rear wing on twin struts with endplates, recessed headlights, a full-width taillight strip, side mirrors, twin exhaust tips, and a round front intake mouth.",
    summary:
      "Built a mid-engine sports car concept — wedge silhouette body with glass canopy, arch pockets around five-spoke wheels, splitter, side skirts, diffuser fins, twin-strut rear wing with endplates, lights, mirrors, exhaust tips, and a round intake mouth. STEP, GLB and STL exported; overall 484 x 210 x 84 mm.",
  },
  {
    slug: "wrist-watch",
    prompt:
      "A luxury wristwatch laid dial-up: 42 mm case with a caseback, stepped bezel with a polished top edge, an open dial with twelve applied hour markers and a double baton at 12, hands set to 10:09:31 with a center cap, a knurled crown at 3 o'clock, engraving rings on the caseback, four lugs, a tapering three-link bracelet on both sides, and a buckle frame with tang at the end.",
    summary:
      "Built a luxury wristwatch laid dial-up — 42 mm case with stepped bezel, twelve applied markers with a double baton at 12, hands set to 10:09:31, knurled crown, caseback engraving rings, four lugs, a tapering three-link bracelet, and a buckle with tang. STEP, GLB and STL exported; overall 49 x 200 x 17 mm.",
  },
];

function freeSlug(base) {
  let slug = base;
  let dir = path.join(APP_MODELS, slug);
  for (let i = 2; fs.existsSync(dir); i++) {
    slug = `${base}-v${i}`;
    dir = path.join(APP_MODELS, slug);
  }
  return { slug, dir };
}

function factsFor(dir) {
  try {
    const out = execFileSync(python, [inspect, "refs", "part.step", "--facts"], {
      cwd: dir,
      encoding: "utf8",
    });
    const token = JSON.parse(out).tokens[0];
    const facts = token.summary ?? null;
    if (facts && token.entryFacts) facts.entryFacts = token.entryFacts;
    return facts;
  } catch {
    return null;
  }
}

fs.mkdirSync(APP_MODELS, { recursive: true });

const now = Date.now();
const entries = [];
const sessionHistory = [];

DEMO.forEach((demo, index) => {
  const srcDir = path.join(DEFAULT_MODELS_ROOT, demo.slug);
  if (!fs.existsSync(path.join(srcDir, "part.step"))) {
    console.error(`skip ${demo.slug}: not built yet (run: node run.mjs ${demo.slug})`);
    return;
  }
  const { slug, dir } = freeSlug(demo.slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, f);
    if (!fs.statSync(src).isFile() || f.startsWith("__pycache__")) continue;
    fs.copyFileSync(src, path.join(dir, f));
  }

  // savedAt staggered so the app groups all five under TODAY with distinct times
  const savedAt = new Date(now - (DEMO.length - index) * 9 * 60 * 1000).toISOString();
  const facts = factsFor(dir);
  const pythonSource = fs.readFileSync(path.join(dir, "part.py"), "utf8");

  const artifact = {
    ok: true,
    slug,
    dir,
    sourcePath: path.join(dir, "part.py"),
    pythonSource,
    stepPath: path.join(dir, "part.step"),
    glbPath: path.join(dir, "part.glb"),
    stlPath: path.join(dir, "part.stl"),
    viewerGlb: path.join(dir, ".part.step.glb"),
    facts,
  };

  entries.push({
    id: `${now}-${slug}`,
    prompt: demo.prompt,
    summary: demo.summary,
    artifact,
    provider: "ox-alpha",
    model: "ox-alpha",
    transcript: [
      { role: "user", text: demo.prompt, at: savedAt },
      { role: "assistant", text: demo.summary, at: savedAt },
    ],
    savedAt,
  });

  sessionHistory.push({
    prompt: demo.prompt,
    summary: demo.summary,
    recordedAt: savedAt,
    slug,
    dir,
    sourcePath: artifact.sourcePath,
    pythonSource,
    facts,
    stepPath: artifact.stepPath,
    glbPath: artifact.glbPath,
    stlPath: artifact.stlPath,
    viewerGlb: artifact.viewerGlb,
  });

  console.log(`seeded: ${demo.slug} -> ${slug}`);
});

if (!entries.length) {
  console.error("Nothing to seed.");
  process.exit(1);
}

// newest first: reverse of build order so the last-built (hero) is items[0]
entries.reverse();
sessionHistory.reverse();

// merge with existing designs (kept, not clobbered)
let existing = [];
try {
  const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  if (parsed?.version === HISTORY_VERSION && Array.isArray(parsed.designs)) {
    existing = parsed.designs;
  }
} catch {}
const merged = [...entries, ...existing.filter((d) => !entries.some((e) => e.id === d.id))];
const payload = JSON.stringify({
  version: HISTORY_VERSION,
  savedAt: new Date().toISOString(),
  designs: merged,
});
const tmp = HISTORY_FILE + ".tmp";
fs.writeFileSync(tmp, payload, "utf8");
fs.renameSync(tmp, HISTORY_FILE);

// session: current design = hero entry, history = all five
const hero = sessionHistory[0];
fs.writeFileSync(
  SESSION_FILE,
  JSON.stringify({ current: hero, history: sessionHistory }),
  "utf8"
);

console.log(`\nhistory: ${merged.length} designs (${entries.length} new) -> ${HISTORY_FILE}`);
console.log(`session: current = ${hero.slug}`);
