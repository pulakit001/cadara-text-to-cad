/**
 * @file main.js
 * @description The main Electron process for Cadara.
 * This file handles window management, IPC (Inter-Process Communication) bindings,
 * secure storage for API keys, and custom protocol registration for loading 3D assets.
 * 
 * @module CadaraMain
 */

const { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const fsPromises = fs.promises;
require("dotenv").config({ path: process.env.CADARA_ENVFILE || ".env" });

if (process.env.CADARA_USERDATA) {
  app.setPath("userData", process.env.CADARA_USERDATA);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "cadarafile",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const isMac = process.platform === "darwin";

let mainWindow = null;
let activeJob = null;
let jobCanceled = false;
let cadSessionPromise = null;

/**
 * Asynchronously loads and initializes the core CAD Session logic.
 * We dynamically import `agent/session.mjs` to keep the startup time fast.
 * @returns {Promise<import('./agent/session.mjs').CadSession>} The initialized CAD Session.
 */
async function getCadSession() {
  if (!cadSessionPromise) {
    cadSessionPromise = import("./agent/session.mjs").then(
      ({ CadSession }) => new CadSession(path.join(app.getPath("userData"), "cad-session.json"))
    );
  }
  return cadSessionPromise;
}

app.whenReady().then(async () => {
  protocol.handle("cadarafile", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    const normalized = path.normalize(filePath);
    const modelsRoot = getModelsRoot();
    if (!normalized.startsWith(modelsRoot)) {
      return new Response("Forbidden", { status: 403 });
    }
    return fsPromises
      .readFile(normalized)
      .then(
        (data) =>
          new Response(data, {
            headers: {
              "Content-Type": path.extname(normalized) === ".glb" ? "model/gltf-binary" : "application/octet-stream",
              "Cache-Control": "no-store",
            },
          })
      )
      .catch((err) => {
        console.error("[cadarafile] read failed:", err.message);
        return new Response("Not found", { status: 404 });
      });
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

/**
 * Returns the local user directory where generated 3D models (.glb/.step) are stored.
 * @returns {string} The absolute path to the models directory.
 */
function getModelsRoot() {
  return path.join(app.getPath("userData"), "models");
}

function getBundledCadRuntime() {
  return app.isPackaged && process.resourcesPath
    ? path.join(process.resourcesPath, "cad-runtime")
    : path.join(__dirname, "cad-runtime");
}

function getCadPython() {
  const runtime = getBundledCadRuntime();
  const bundledPython = process.platform === "win32"
    ? path.join(runtime, ".venv", "Scripts", "python.exe")
    : path.join(runtime, ".venv", "bin", "python");
  const developerPython = path.join(process.env.HOME || "", ".agents", "skills", "cad", ".venv", "bin", "python");
  const candidates = app.isPackaged
    ? [process.env.CAD_PYTHON, bundledPython]
    : [process.env.CAD_PYTHON, path.join(runtime, ".venv", "bin", "python"), developerPython];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates.find(Boolean) || bundledPython;
}

/**
 * Initializes and creates the main Electron BrowserWindow.
 * Configures the window dimensions, visual styling (e.g. hidden title bar on Mac),
 * and attaches the preload script for secure IPC communication.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Cadara",
    backgroundColor: "#0b0e14",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.env.CADARA_SHOT && !process.env.CADARA_E2E) {
    mainWindow.webContents.on("console-message", (_e, level, message) => {
      console.log("[renderer]", level, message);
    });
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.capturePage();
          require("node:fs").writeFileSync(process.env.CADARA_SHOT, image.toPNG());
          console.log("[shot] saved", process.env.CADARA_SHOT);
        } catch (err) {
          console.log("[shot] failed", err.message);
        }
        try {
          const report = await mainWindow.webContents.executeJavaScript(`(() => {
            const q = (s) => document.querySelector(s);
            return {
              modelOptions: q("#model-select")?.options.length ?? -1,
              hasCanvas: !!q("#viewer canvas"),
              chatMessages: q("#chat")?.children.length ?? -1,
              importMap: !!document.querySelector('script[type="importmap"]'),
              errorLog: window.__errors || [],
            };
          })()`);
          console.log("[dom]", JSON.stringify(report));
        } catch (err) {
          console.log("[dom] failed", err.message);
        }
        app.quit();
      }, 2500);
    });
  }

  if (process.env.CADARA_E2E) {
    mainWindow.webContents.on("console-message", (_e, level, message) => {
      console.log("[renderer]", level, message);
    });
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const prompt = process.env.CADARA_E2E;
        const shotPath = process.env.CADARA_SHOT || path.join(os.tmpdir(), "cadara-e2e.png");
        const noKey = Boolean(process.env.CADARA_NO_KEY);
        const testKey = process.env.CADARA_TEST_KEY || process.env.GEMINI_API_KEY || "";
        try {
          const ui = await mainWindow.webContents.executeJavaScript(`(async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const out = {};
            if (${noKey ? "false" : "true"} && ${JSON.stringify(testKey)}) {
              document.getElementById("settings-btn").click();
              await sleep(300);
              document.getElementById("gemini-key").value = ${JSON.stringify(testKey)};
              document.getElementById("test-key-gemini").click();
              await sleep(4000);
              out.testNote = document.getElementById("settings-note").textContent;
              document.getElementById("settings-form").dispatchEvent(new Event("submit", { cancelable: true }));
              await sleep(1800);
              out.modalHiddenAfterSave = document.getElementById("modal").hidden;
              out.chatAfterSave = document.getElementById("chat").children.length;
              out.suggestionsVisible = !document.getElementById("suggestions").hidden;
            }
            const ta = document.getElementById("prompt");
            ta.value = ${JSON.stringify(prompt)};
            document.getElementById("prompt-form").dispatchEvent(new Event("submit", { cancelable: true }));
            return out;
          })()`);
          console.log("[e2e] ui:", JSON.stringify(ui));
          const result = await mainWindow.webContents.executeJavaScript(
            `new Promise((resolve) => {
              const check = () => {
                const q = (s) => document.querySelector(s);
                const chip = q("#iter-chip");
                const overlay = q("#viewer-overlay");
                const button = q("#send-btn");
                const failed = button.disabled === false && (q(".msg.system") !== null);
                const finished = button.disabled === false && (overlay && !overlay.hidden);
                if (finished || failed) {
                  resolve({
                    chip: chip?.textContent || "",
                    artifactName: q("#artifact-name")?.textContent || "",
                    artifactDims: q("#artifact-dims")?.textContent || "",
                    chatMessages: q("#chat")?.children.length ?? -1,
                    errorLog: window.__errors || [],
                  });
                } else {
                  setTimeout(check, 1500);
                }
              };
              check();
              setTimeout(() => resolve({ timeout: true, chip: document.querySelector("#iter-chip")?.textContent || "", chatMessages: document.querySelector("#chat")?.children.length ?? -1, errorLog: window.__errors || [] }), 240000);
            })`
          );
          console.log("[e2e] done:", JSON.stringify(result));
          const image = await mainWindow.capturePage();
          require("node:fs").writeFileSync(shotPath, image.toPNG());
          console.log("[e2e] shot saved", shotPath);

          // Optional texture pass: CADARA_E2E_TEXTURE="brushed aluminium" drives
          // the canvas texture panel through the real engine path.
          if (process.env.CADARA_E2E_TEXTURE) {
            const textureShot = process.env.CADARA_SHOT_TEXTURE || shotPath.replace(/\.png$/, "-texture.png");
            const textureOut = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              (async () => {
                const q = (s) => document.querySelector(s);
                const panel = q("#texture-panel");
                if (!panel || panel.hidden) return { error: "texture panel not visible" };
                q("#texture-input").value = ${JSON.stringify(process.env.CADARA_E2E_TEXTURE)};
                q("#texture-ok").click();
                for (let i = 0; i < 90; i++) {
                  await sleep(1000);
                  const status = (q("#texture-status")?.textContent || "").trim();
                  if (status && !status.startsWith("Sending")) return { status, removeHidden: q("#texture-remove")?.hidden };
                }
                return { timeout: true, status: (q("#texture-status")?.textContent || "").trim() };
              })();
            })`);
            console.log("[e2e] texture:", JSON.stringify(textureOut));
            const textureImage = await mainWindow.capturePage();
            require("node:fs").writeFileSync(textureShot, textureImage.toPNG());
            console.log("[e2e] texture shot saved", textureShot);
          }
          app.quit();
        } catch (err) {
          console.log("[e2e] failed:", err.message);
          app.quit();
        }
      }, 3000);
    });
  }
}

// ---------- settings (API key via safeStorage) ----------

/**
 * Returns the absolute path to the encrypted settings file.
 * @returns {string} The path to `settings.json` in the user data directory.
 */
function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

const KEY_FIELDS = ["geminiApiKey", "groqApiKey", "openaiApiKey", "claudeApiKey", "openrouterApiKey"];
const PROVIDER_IDS = ["gemini", "groq", "openai", "claude", "openrouter"];
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_ACTIVE_SKILLS = 2;
const MAX_SKILL_BODY_LENGTH = 2000;

function skillsFile() {
  return path.join(app.getPath("userData"), "skills.json");
}

function readSkills() {
  try {
    return JSON.parse(fs.readFileSync(skillsFile(), "utf8"));
  } catch {
    return [];
  }
}

function writeSkills(skills) {
  fs.writeFileSync(skillsFile(), JSON.stringify(skills, null, 2));
}

function readAiConfig() {
  const settings = readSettings();
  return {
    temperature: typeof settings.aiTemperature === "number" ? settings.aiTemperature : 0.1,
    maxIterations: typeof settings.aiMaxIterations === "number" ? settings.aiMaxIterations : 8,
    qualityMode: ["fast", "balanced", "thorough"].includes(settings.aiQualityMode) ? settings.aiQualityMode : "balanced",
    wallThickness: typeof settings.aiWallThickness === "number" ? settings.aiWallThickness : 3.0,
    defaultTolerance: typeof settings.aiDefaultTolerance === "number" ? settings.aiDefaultTolerance : 1.0,
    filletStrategy: ["conservative", "moderate", "aggressive"].includes(settings.aiFilletStrategy) ? settings.aiFilletStrategy : "moderate",
    prePromptInstruction: typeof settings.aiPrePrompt === "string" ? settings.aiPrePrompt : "",
  };
}

function writeAiConfig(config) {
  const settings = readSettings();
  if (typeof config.temperature === "number") settings.aiTemperature = Math.max(0, Math.min(1, config.temperature));
  if (typeof config.maxIterations === "number") settings.aiMaxIterations = Math.max(1, Math.min(12, Math.round(config.maxIterations)));
  if (["fast", "balanced", "thorough"].includes(config.qualityMode)) settings.aiQualityMode = config.qualityMode;
  if (typeof config.wallThickness === "number") settings.aiWallThickness = Math.max(0.1, Math.min(50, config.wallThickness));
  if (typeof config.defaultTolerance === "number") settings.aiDefaultTolerance = Math.max(0.01, Math.min(10, config.defaultTolerance));
  if (["conservative", "moderate", "aggressive"].includes(config.filletStrategy)) settings.aiFilletStrategy = config.filletStrategy;
  if (typeof config.prePromptInstruction === "string") settings.aiPrePrompt = config.prePromptInstruction.slice(0, 5000);
  writeSettings(settings);
}

function readSettings({ purgeBadKeys = false } = {}) {
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    let parsed = JSON.parse(raw);
    let dirty = false;

    if (!parsed.apiKeys) {
      parsed.apiKeys = {};
      dirty = true;
    }
    for (const p of PROVIDER_IDS) {
      if (!parsed.apiKeys[p]) {
        parsed.apiKeys[p] = [];
        dirty = true;
      }
    }

    if (safeStorage.isEncryptionAvailable()) {
      // Migrate old format to new format
      const oldKeyMap = {
        geminiApiKey: "gemini",
        groqApiKey: "groq",
        openaiApiKey: "openai",
        claudeApiKey: "claude",
      };
      
      for (const [oldField, providerId] of Object.entries(oldKeyMap)) {
        if (parsed[oldField]) {
          let dec;
          try {
            dec = safeStorage.decryptString(Buffer.from(parsed[oldField], "base64"));
          } catch {
            dec = parsed[oldField]; // Fallback if it wasn't encrypted
          }
          if (dec) {
            parsed.apiKeys[providerId].push({
              id: "migrated-" + Date.now(),
              label: "Default Key",
              key: dec,
              active: true
            });
            delete parsed[oldField];
            dirty = true;
          } else if (purgeBadKeys) {
            delete parsed[oldField];
            dirty = true;
          }
        }
      }

      // Decrypt new format keys
      for (const p of PROVIDER_IDS) {
        const validKeys = [];
        for (const k of parsed.apiKeys[p]) {
          try {
            // we keep it decrypted in memory
            if (k.encrypted) {
              k.key = safeStorage.decryptString(Buffer.from(k.key, "base64"));
              delete k.encrypted;
            }
            validKeys.push(k);
          } catch {
            if (purgeBadKeys) {
              dirty = true;
            } else {
              validKeys.push(k);
            }
          }
        }
        parsed.apiKeys[p] = validKeys;
      }
    } else {
      // If encryption is not available, we assume old format was plain text (or we can't read it)
      // but let's migrate anyway if it exists
      const oldKeyMap = {
        geminiApiKey: "gemini",
        groqApiKey: "groq",
        openaiApiKey: "openai",
        claudeApiKey: "claude",
      };
      for (const [oldField, providerId] of Object.entries(oldKeyMap)) {
        if (parsed[oldField]) {
          parsed.apiKeys[providerId].push({
            id: "migrated-" + Date.now(),
            label: "Default Key",
            key: parsed[oldField],
            active: true
          });
          delete parsed[oldField];
          dirty = true;
        }
      }
    }

    if (dirty) {
      writeSettings(parsed);
    }
    return parsed;
  } catch {
    return {
      apiKeys: {
        gemini: [],
        groq: [],
        openai: [],
        claude: [],
        openrouter: []
      }
    };
  }
}

const probeCache = new Map();

// Validate a provider key against the provider's model-listing endpoint —
// cheap, no tokens, and no dependence on any specific model being live.
async function probeProviderKey(providerId, key) {
  if (!key) return "nokey";
  const cacheKey = providerId + ":" + key.slice(0, 16);
  if (probeCache.has(cacheKey)) return probeCache.get(cacheKey);
  let status = "other";
  try {
    let res;
    if (providerId === "gemini") {
      res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(20000),
      });
    } else if (providerId === "claude") {
      const { PROVIDERS } = await import("./agent/llm.mjs");
      res = await fetch(PROVIDERS.claude.baseUrl + "/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(20000),
      });
    } else {
      const { PROVIDERS } = await import("./agent/llm.mjs");
      const provider = PROVIDERS[providerId];
      if (!provider) return "invalid";
      res = await fetch(provider.baseUrl + "/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
      });
    }
    if (res.status === 200) status = "ok";
    else if (res.status === 401 || res.status === 403) status = "invalid";
    else if (res.status === 429) status = "ratelimited";
  } catch {
    status = "unreachable";
  }
  probeCache.set(cacheKey, status);
  return status;
}

function clearStoredKey(field) {
  const s = readSettings();
  if (!s[field]) return;
  delete s[field];
  writeSettings(s);
}

function writeSettings(settings) {
  // Deep clone to avoid mutating the in-memory object
  const toSave = JSON.parse(JSON.stringify(settings));
  
  if (safeStorage.isEncryptionAvailable()) {
    if (toSave.apiKeys) {
      for (const p of PROVIDER_IDS) {
        if (toSave.apiKeys[p]) {
          for (const k of toSave.apiKeys[p]) {
            if (k.key && !k.encrypted) {
              k.key = safeStorage.encryptString(k.key).toString("base64");
              k.encrypted = true;
            }
          }
        }
      }
    }
    // Handle any stray old fields just in case
    for (const field of KEY_FIELDS) {
      if (toSave[field]) toSave[field] = safeStorage.encryptString(toSave[field]).toString("base64");
    }
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(toSave, null, 2));
}

function keyFor(provider) {
  const settings = readSettings({ purgeBadKeys: true });
  if (settings.apiKeys && settings.apiKeys[provider.id]) {
    const activeKey = settings.apiKeys[provider.id].find(k => k.active);
    if (activeKey && activeKey.key) return activeKey.key;
  }
  return process.env[provider.keyEnv] || "";
}

function normalizeReferenceImage(input) {
  if (!input || typeof input !== "object") return null;
  const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";
  const match = dataUrl.match(IMAGE_DATA_URL_RE);
  if (!match) throw new Error("Reference image must be PNG, JPEG, or WebP.");
  const byteLength = Buffer.byteLength(match[2], "base64");
  if (byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("Reference image is too large. Use an image under 10 MB.");
  }
  return {
    name: String(input.name || "reference image").slice(0, 140),
    mimeType: match[1],
    size: byteLength,
    dataUrl,
  };
}

// ---------- IPC ----------

ipcMain.handle("settings:getKeys", () => {
  const s = readSettings({ purgeBadKeys: true });
  
  // Return masked keys
  const maskedKeys = {};
  for (const p of PROVIDER_IDS) {
    maskedKeys[p] = (s.apiKeys[p] || []).map(k => {
      const isEnv = false; // Env keys aren't stored here
      let displayKey = k.key || "";
      if (displayKey.length > 8) {
        displayKey = displayKey.slice(0, 4) + "..." + displayKey.slice(-4);
      }
      return { id: k.id, label: k.label, key: displayKey, active: k.active, isEnv };
    });
    
    // Also include env keys if they exist and no stored key is active?
    // Actually, just keep it simple: UI shows what's in settings.
  }
  return maskedKeys;
});

ipcMain.handle("settings:addKey", (_event, { provider, label, key }) => {
  if (!PROVIDER_IDS.includes(provider) || !key || !key.trim()) return { ok: false, error: "Invalid key." };
  const settings = readSettings({ purgeBadKeys: true });
  if (!settings.apiKeys[provider]) settings.apiKeys[provider] = [];
  
  const isFirst = settings.apiKeys[provider].length === 0;
  // If first key, make it active. Otherwise, deactivate others if we make this one active? No, just false by default unless first
  
  settings.apiKeys[provider].push({
    id: "key-" + Date.now(),
    label: label || "New Key",
    key: key.trim(),
    active: isFirst
  });
  
  writeSettings(settings);
  return { ok: true };
});

ipcMain.handle("settings:removeKey", (_event, { provider, id }) => {
  if (!PROVIDER_IDS.includes(provider)) return { ok: false, error: "Invalid provider." };
  const settings = readSettings({ purgeBadKeys: true });
  if (!settings.apiKeys[provider]) return { ok: false };
  
  const wasActive = settings.apiKeys[provider].find(k => k.id === id)?.active;
  settings.apiKeys[provider] = settings.apiKeys[provider].filter(k => k.id !== id);
  
  // If we removed the active key, make the first remaining one active
  if (wasActive && settings.apiKeys[provider].length > 0) {
    settings.apiKeys[provider][0].active = true;
  }
  
  writeSettings(settings);
  return { ok: true };
});

ipcMain.handle("settings:toggleKey", (_event, { provider, id }) => {
  if (!PROVIDER_IDS.includes(provider)) return { ok: false, error: "Invalid provider." };
  const settings = readSettings({ purgeBadKeys: true });
  if (!settings.apiKeys[provider]) return { ok: false };
  
  for (const k of settings.apiKeys[provider]) {
    k.active = (k.id === id);
  }
  
  writeSettings(settings);
  return { ok: true };
});

// Old handler - keeping it to avoid breaking changes if any old code uses it, 
// but we'll return ok: true. The UI will use addKey/removeKey now.
ipcMain.handle("settings:set", (_event, keys = {}) => {
  return { ok: true };
});

ipcMain.handle("settings:test", async (_event, { provider: providerId, apiKey } = {}) => {
  const { PROVIDERS } = await import("./agent/llm.mjs");
  const provider = PROVIDERS[providerId];
  if (!provider) return { ok: false, error: "Unknown provider." };
  const key = (apiKey || "").trim() || keyFor(provider);
  if (!key) return { ok: false, error: "No key to test." };
  const status = await probeProviderKey(providerId, key);
  if (status === "ok") return { ok: true };
  if (status === "invalid") return { ok: false, error: `Invalid ${provider.label} API key.` };
  if (status === "ratelimited") {
    return { ok: false, error: "Rate limited — the key is valid but the provider is busy. Try again in a moment." };
  }
  if (status === "unreachable") {
    return { ok: false, error: `Could not reach ${provider.label}. Check your connection.` };
  }
  return { ok: false, error: `${provider.label} error — try again in a moment.` };
});

ipcMain.handle("skills:list", () => {
  return readSkills();
});

ipcMain.handle("skills:save", (_event, skill) => {
  const skills = readSkills();
  const existing = skills.find((s) => s.id === skill.id);
  if (existing) {
    Object.assign(existing, skill);
  } else {
    skills.push(skill);
  }
  
  if (skill.active) {
    const activeSkills = skills.filter((s) => s.active);
    if (activeSkills.length > MAX_ACTIVE_SKILLS) {
      return { ok: false, error: `Maximum of ${MAX_ACTIVE_SKILLS} active skills allowed.` };
    }
  }
  if (skill.body && skill.body.length > MAX_SKILL_BODY_LENGTH) {
    return { ok: false, error: `Skill body exceeds maximum length of ${MAX_SKILL_BODY_LENGTH} characters.` };
  }

  writeSkills(skills);
  return { ok: true };
});

ipcMain.handle("skills:delete", (_event, id) => {
  const skills = readSkills();
  const filtered = skills.filter((s) => s.id !== id);
  writeSkills(filtered);
  return { ok: true };
});

ipcMain.handle("settings:getAiConfig", () => {
  return readAiConfig();
});

ipcMain.handle("settings:setAiConfig", (_event, config) => {
  writeAiConfig(config);
  return { ok: true };
});

ipcMain.handle("chat:send", async (_event, { prompt, provider: providerId, model, referenceImage, clientJobId } = {}) => {
  if (jobCanceled) jobCanceled = false;
  if (activeJob) return { ok: false, error: "A job is already running." };
  if (!prompt || !prompt.trim()) return { ok: false, error: "Empty prompt." };
  let normalizedReferenceImage = null;
  try {
    normalizedReferenceImage = normalizeReferenceImage(referenceImage);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  const { PROVIDERS } = await import("./agent/llm.mjs");
  const provider = PROVIDERS[providerId] || PROVIDERS[process.env.LLM_PROVIDER] || null;
  if (!provider) return { ok: false, error: "Pick a provider first." };

  const apiKey = keyFor(provider);
  if (!apiKey) {
    return {
      ok: false,
      error: `No ${provider.label} API key set. Add ${provider.keyEnv} to .env or paste it in Settings.`,
    };
  }
  console.log("[cadara] using", provider.label, "with model", model || "(auto)");

  const [{ runAgent }, cadSession] = await Promise.all([
    import("./agent/agent.mjs"),
    getCadSession(),
  ]).catch((err) => {
    throw new Error("Agent failed to load: " + (err && err.message ? err.message : String(err)));
  });

  const activeSkills = readSkills().filter(s => s.active).map(s => ({ name: s.name, body: s.body }));
  const aiConfig = readAiConfig();

  activeJob = {
    cancel: () => {
      jobCanceled = true;
      // Abort in-flight LLM requests, backoff sleeps, and Python builds so
      // the cancel takes effect immediately, not at the next pipeline event.
      if (jobAbort) jobAbort.abort();
    },
  };
  const jobAbort = new AbortController();

  const emit = (type, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("chat:event", { type, payload, clientJobId: clientJobId || null });
  };

  try {
    const result = await runAgent({
      prompt,
      apiKey,
      provider: provider.id,
      model,
      modelsRoot: getModelsRoot(),
      sessionSnapshot: cadSession.snapshot(),
      referenceImage: normalizedReferenceImage,
      skills: activeSkills,
      aiConfig,
      signal: jobAbort.signal,
      onEvent: (type, payload) => {
        if (jobCanceled) throw new Error("canceled");
        emit(type, payload);
      },
    });
    if (jobCanceled) return { ok: false, canceled: true, error: "Canceled." };
    cadSession.record({ prompt, result, summary: result.summary, routing: result.routing });
    return { ok: true, result };
  } catch (err) {
    if (jobCanceled) return { ok: false, canceled: true, error: "Canceled." };
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    activeJob = null;
  }
});

ipcMain.handle("chat:cancel", () => {
  if (activeJob) activeJob.cancel();
  return { ok: true };
});

// Texture pass: a lightweight secondary LLM call that converts a texture
// description into a viewer material spec for an already-generated part.
// It never runs the CAD pipeline and never runs without a finished artifact.
ipcMain.handle("texture:generate", async (_event, { description, provider: providerId, model, artifact } = {}) => {
  const text = typeof description === "string" ? description.trim() : "";
  if (!text) return { ok: false, error: "Describe the texture first." };
  if (!artifact || !artifact.slug) {
    return { ok: false, error: "Generate a part first — texture is applied to the finished model." };
  }

  const { PROVIDERS, LLM } = await import("./agent/llm.mjs");
  const provider = PROVIDERS[providerId] || PROVIDERS[process.env.LLM_PROVIDER] || null;
  if (!provider) return { ok: false, error: "Pick a provider first." };
  const apiKey = keyFor(provider);
  if (!apiKey) {
    return { ok: false, error: `No ${provider.label} API key set. Add ${provider.keyEnv} to .env or paste it in Settings.` };
  }

  const { texturePrompt } = await import("./agent/prompts.mjs");
  const llm = new LLM({ provider: provider.id, apiKey, model });

  const partFacts = {
    slug: artifact.slug,
    name: artifact.displayName || artifact.slug,
    facts: artifact.facts || null,
  };

  try {
    const message = await llm.chat({
      temperature: 0.1,
      messages: [
        { role: "system", content: texturePrompt() },
        {
          role: "user",
          content:
            `PART (already built, texture applies to this part only)\n${JSON.stringify(partFacts)}\n\n` +
            `TEXTURE REQUEST\n${text}`,
        },
      ],
    });
    const content = typeof message?.content === "string" ? message.content : "";
    const match = content.match(/\{[\s\S]*\}/);
    let spec = null;
    try {
      spec = match ? JSON.parse(match[0]) : null;
    } catch {
      spec = null;
    }
    if (!spec || typeof spec !== "object") {
      return { ok: false, error: "The model returned an unreadable texture spec. Try rephrasing the finish." };
    }
    spec.request = text;
    spec.slug = artifact.slug;
    return { ok: true, spec };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("file:info", async (_event, relPath) => {
  const filePath = path.join(getModelsRoot(), relPath || "");
  try {
    const stat = await fsPromises.stat(filePath);
    const ext = path.extname(filePath).slice(1).toUpperCase();
    return {
      ok: true,
      name: path.basename(filePath),
      size: stat.size,
      sizeLabel: stat.size > 1024 * 1024 ? (stat.size / (1024 * 1024)).toFixed(1) + " MB" : Math.round(stat.size / 1024) + " KB",
      ext,
    };
  } catch {
    return { ok: false };
  }
});



ipcMain.handle("file:save", async (_event, { relPath, name, filters } = {}) => {
  const filePath = path.join(getModelsRoot(), relPath || "");
  const defaultPath = name ? path.join(app.getPath("downloads"), name) : undefined;
  const { canceled, filePath: dest } = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: filters || [{ name: "All Files", extensions: ["*"] }],
  });
  if (canceled || !dest) return { ok: false, canceled: true };
  try {
    await fsPromises.copyFile(filePath, dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("session:clear", async () => {
  const cadSession = await getCadSession();
  cadSession.clear();
  return { ok: true };
});

// Reopens a saved design as the session's current context so follow-up
// "modify" prompts work on chats restored from history.
ipcMain.handle("session:restore", async (_event, { entry } = {}) => {
  const cadSession = await getCadSession();
  const restored = cadSession.restore(entry);
  return { ok: restored };
});

ipcMain.handle("file:export", async (event, { relPath, format, name } = {}) => {
  const filePath = path.join(getModelsRoot(), relPath || "");
  const defaultPath = name ? path.join(app.getPath("downloads"), name) : undefined;
  
  // Set up filters based on format
  const extensions = format === "3mf" ? ["3mf"] : 
                     format === "obj" ? ["obj"] :
                     format === "ply" ? ["ply"] :
                     format === "iges" ? ["iges", "igs"] :
                     format === "dxf" ? ["dxf"] :
                     format === "svg" ? ["svg"] :
                     format === "step" ? ["step", "stp"] :
                     format === "stl" ? ["stl"] :
                     format === "glb" ? ["glb"] : ["*"];
                     
  const { canceled, filePath: dest } = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [{ name: `${format.toUpperCase()} Files`, extensions }],
  });
  
  if (canceled || !dest) return { ok: false, canceled: true };
  
  try {
    // If it's a natively generated file, just copy it
    if (["step", "stl", "glb"].includes(format)) {
      await fsPromises.copyFile(filePath, dest);
      return { ok: true, path: dest };
    }
    
    // Send progress event
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("file:exportProgress", { status: "converting", format });
    }
    
    // Otherwise run the conversion script
    const python = getCadPython();
    const script = path.join(getBundledCadRuntime(), "scripts", "export_formats.py");
    const dir = path.dirname(filePath);
    
    const { spawn } = require("node:child_process");
    
    return new Promise((resolve) => {
      const child = spawn(python, [script, filePath, "--format", format, "--output", dest], { cwd: dir });
      
      let stderr = "";
      child.stderr.on("data", (data) => stderr += data.toString());
      
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ ok: true, path: dest });
        } else {
          resolve({ ok: false, error: "Conversion failed: " + stderr });
        }
      });
    });
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("app:meta", async () => {
  const { PROVIDERS, listModels, listModelPackets } = await import("./agent/llm.mjs");
  const providers = {};
  for (const provider of Object.values(PROVIDERS)) {
    const key = keyFor(provider);
    const models = key ? await listModels(provider.id, key) : null;
    providers[provider.id] = {
      label: provider.label,
      hasKey: Boolean(key),
      models,
      packets: listModelPackets(provider.id, models || []),
    };
  }
  return {
    version: app.getVersion(),
    modelsRoot: getModelsRoot(),
    cadPython: getCadPython(),
    providers,
    defaultProvider: process.env.LLM_PROVIDER || null,
    defaultModel: process.env.LLM_MODEL || null,
  };
});
