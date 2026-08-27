// Durable previous-designs store for the Electron main process.
// A JSON file in userData backs every saved design so history survives
// restarts, quota walls, and fresh renderer profiles. Writes are atomic:
// temp file first, then rename over the live store.

const { app, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const HISTORY_STORE_VERSION = 2;
const MAX_PREVIOUS_DESIGNS = 500;
// Bytes the store may grow to before oldest entries are evicted. Transcript
// and generated-source fields dominate size, so an unbounded store would
// eventually slow every boot and write.
const MAX_HISTORY_BYTES = 6 * 1024 * 1024;
// Per-field caps: history is for reopening and modifying designs, not an
// archive of multi-megabyte sources. Values beyond these lose their tail.
const MAX_SOURCE_CHARS = 150_000;

function historyStoreFile() {
  return path.join(app.getPath("userData"), "previous-designs.json");
}

function clampChars(value, max) {
  if (typeof value !== "string") return value === undefined || value === null ? "" : value;
  return value.length <= max ? value : value.slice(0, max);
}

// Normalizes one entry in place: stable shape, bounded field sizes, ISO
// timestamps. Corrupt entries are stripped rather than persisted forever.
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.id) return null;
  const artifact =
    entry.artifact && typeof entry.artifact === "object"
      ? {
          ...entry.artifact,
          pythonSource: clampChars(entry.artifact.pythonSource, MAX_SOURCE_CHARS),
        }
      : undefined;
  const normalized = {
    id: String(entry.id).slice(0, 120),
    prompt: clampChars(entry.prompt, 4_000),
    summary: clampChars(entry.summary, 4_000),
    artifact,
    provider: typeof entry.provider === "string" ? entry.provider.slice(0, 40) : entry.provider,
    model: clampChars(entry.model, 160),
    savedAt:
      (entry.savedAt && !Number.isNaN(new Date(entry.savedAt).getTime()) && entry.savedAt) ||
      new Date().toISOString(),
    transcript: Array.isArray(entry.transcript)
      ? entry.transcript.slice(-40).map((row) => ({
          role: row && row.role ? String(row.role).slice(0, 20) : "system",
          text: clampChars(row && row.text, 2_000),
          ...(row && row.at ? { at: row.at } : {}),
        }))
      : [],
  };
  return normalized;
}

function readHistoryStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyStoreFile(), "utf8"));
    if (parsed && parsed.version === HISTORY_STORE_VERSION && Array.isArray(parsed.designs)) {
      const seen = new Set();
      const out = [];
      for (const raw of parsed.designs) {
        const entry = normalizeEntry(raw);
        // Deduplicate by id — legacy merges could leave shadow copies behind.
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        out.push(entry);
      }
      return out.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    }
  } catch {
    // Missing or corrupt store: start empty rather than crash.
  }
  return [];
}

function writeHistoryStore(items) {
  const seen = new Set();
  const designs = [];
  let bytes = JSON.stringify({ version: HISTORY_STORE_VERSION, designs }).length;
  for (const raw of items) {
    const entry = normalizeEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    const size = Buffer.byteLength(JSON.stringify(entry), "utf8") + 8;
    if (designs.length >= MAX_PREVIOUS_DESIGNS || bytes + size > MAX_HISTORY_BYTES) break;
    seen.add(entry.id);
    designs.push(entry);
    bytes += size;
  }
  const payload = JSON.stringify({
    version: HISTORY_STORE_VERSION,
    savedAt: new Date().toISOString(),
    designs,
  });
  const tmpPath = historyStoreFile() + ".tmp";
  try {
    fs.writeFileSync(tmpPath, payload, "utf8");
    if (process.platform === "win32") fs.rmSync(historyStoreFile(), { force: true });
    fs.renameSync(tmpPath, historyStoreFile());
  } catch {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
  }
  return designs.length;
}

function registerHistoryIpc() {
  ipcMain.handle("history:list", () => readHistoryStore());

  ipcMain.handle("history:save", (_event, entry) => {
    if (!entry || typeof entry !== "object" || !entry.id) return { ok: false };
    // Upsert by id, newest first.
    const designs = readHistoryStore().filter((d) => d.id !== entry.id);
    designs.unshift(entry);
    writeHistoryStore(designs);
    return { ok: true, count: designs.length };
  });

  ipcMain.handle("history:delete", (_event, id) => {
    writeHistoryStore(readHistoryStore().filter((d) => d.id !== id));
    return { ok: true };
  });

  ipcMain.handle("history:clear", () => {
    writeHistoryStore([]);
    return { ok: true };
  });

  // One-time migration of legacy renderer-localStorage entries so designs
  // saved by older builds survive the switch to the durable store.
  ipcMain.handle("history:importLegacy", (_event, items) => {
    if (!Array.isArray(items)) return { ok: false, imported: 0 };
    const existing = new Map(readHistoryStore().map((d) => [d.id, d]));
    let imported = 0;
    for (const item of items) {
      if (!item || !item.id || existing.has(item.id)) continue;
      existing.set(item.id, item);
      imported++;
    }
    const merged = [...existing.values()].sort(
      (a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0)
    );
    writeHistoryStore(merged);
    return { ok: true, total: merged.length, imported };
  });
}

module.exports = { readHistoryStore, writeHistoryStore, registerHistoryIpc, HISTORY_STORE_VERSION, MAX_PREVIOUS_DESIGNS };
