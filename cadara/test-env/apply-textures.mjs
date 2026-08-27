#!/usr/bin/env node
// Applies realistic viewer material specs (the same shape the app's texture
// subagent returns) to the five seeded designs in the Cadara app store.
//
//   node apply-textures.mjs
//
// Specs ride on artifact.textureSpec so the app restores them whenever the
// design is opened from the chat history list.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const USER_DATA = process.env.CADARA_USERDATA
  || path.join(os.homedir(), "Library", "Application Support", "cadara");
const HISTORY_FILE = path.join(USER_DATA, "previous-designs.json");
const SESSION_FILE = path.join(USER_DATA, "cad-session.json");
const HISTORY_VERSION = 2;

const SPECS = {
  "v12-engine": {
    name: "Cast Aluminium",
    baseColor: "#aeb4bc",
    metalness: 0.45,
    roughness: 0.5,
    pattern: "hammered",
    patternScale: 1.4,
    bumpStrength: 0.45,
    finish: "satin",
    request: "cast aluminium engine with a rough as-cast surface",
    notes: "Cast aluminium with a hammered as-cast grain and satin finish.",
  },
  "dc-motor": {
    name: "Brushed Steel",
    baseColor: "#b8bdc4",
    metalness: 0.5,
    roughness: 0.45,
    pattern: "brushed",
    patternScale: 1.5,
    bumpStrength: 0.3,
    finish: "satin",
    request: "brushed steel industrial motor housing",
    notes: "Brushed steel with a fine directional grain and satin finish.",
  },
  "studio-speaker": {
    name: "Matte Black",
    baseColor: "#22252b",
    metalness: 0.05,
    roughness: 0.8,
    pattern: "none",
    patternScale: 1,
    bumpStrength: 0,
    finish: "matte",
    request: "matte black vinyl-wrap cabinet finish",
    notes: "Matte black cabinet wrap with a soft non-reflective finish.",
  },
  "sports-car": {
    name: "Racing Red",
    baseColor: "#c02733",
    metalness: 0.3,
    roughness: 0.2,
    pattern: "none",
    patternScale: 1,
    bumpStrength: 0,
    finish: "glossy",
    request: "glossy racing red paint with a deep clear coat",
    notes: "Glossy racing-red paint with a deep clear coat.",
  },
  "wrist-watch": {
    name: "Polished Steel",
    baseColor: "#d8dce2",
    metalness: 0.55,
    roughness: 0.25,
    pattern: "none",
    patternScale: 1,
    bumpStrength: 0,
    finish: "glossy",
    request: "polished stainless steel case and bracelet",
    notes: "Polished stainless steel with a mirror gloss.",
  },
};

function specFor(slug) {
  const key = Object.keys(SPECS).find((k) => slug === k || slug.startsWith(`${k}-v`));
  if (!key) return null;
  return { ...SPECS[key], slug };
}

function writeAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

// --- history ---
const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
let applied = 0;
for (const design of history.designs) {
  const spec = specFor(design.artifact?.slug || "");
  if (!spec) continue;
  design.artifact.textureSpec = spec;
  applied++;
}
writeAtomic(HISTORY_FILE, JSON.stringify({ ...history, savedAt: new Date().toISOString() }, null, 1));

// --- session (extra field is harmless; keeps context consistent) ---
try {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  for (const entry of [session.current, ...(session.history || [])]) {
    if (!entry) continue;
    const spec = specFor(entry.slug || "");
    if (spec) entry.textureSpec = spec;
  }
  writeAtomic(SESSION_FILE, JSON.stringify(session));
} catch {}

for (const [slug, spec] of Object.entries(SPECS)) {
  console.log(`textured: ${slug.padEnd(15)} -> ${spec.name} (${spec.finish}, metal ${spec.metalness}, rough ${spec.roughness})`);
}
console.log(`\napplied to ${applied} history designs -> ${HISTORY_FILE}`);
