// Durable previous-designs store for the Electron main process.
// A JSON file in userData backs every saved design so history survives
// restarts, quota walls, and fresh renderer profiles. Writes are atomic:
// temp file first, then rename over the live store.

const { app, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const HISTORY_STORE_VERSION = 2;
const MAX_PREVIOUS_DESIGNS = 500;

function historyStoreFile() {
  return path.join(app.getPath("userData"), "previous-designs.json");
}

function readHistoryStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyStoreFile(), "utf8"));
    if (parsed && parsed.version === HISTORY_STORE_VERSION && Array.isArray(parsed.designs)) {
      return parsed.designs.filter((d) => d && d.id);
    }
  } catch {
    // Missing or corrupt store: start empty rather than crash.
  }
  return [];
}

function writeHistoryStore(items) {
  const designs = items.filter((d) => d && d.id).slice(0, MAX_PREVIOUS_DESIGNS);
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
