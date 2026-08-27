/**
 * @file diag-keyprobe.cjs
 * @description One-shot diagnostic run INSIDE Electron so safeStorage can
 * decrypt the keys the app really uses (Settings-stored). For each configured
 * provider: decrypt, mask, list catalogs, fire ONE minimal chat call, and
 * print status/latency/rate-limit headers/error body. Never prints key
 * material. Run: npx electron diag-keyprobe.cjs
 */

const { app, safeStorage } = require("electron");
// Chromium picks the macOS Keychain safeStorage service from the app NAME.
// The dev app is package "cadara", so set it BEFORE anything else or
// decryption targets a different, freshly-created secret and fails.
app.setName("cadara");
const fs = require("node:fs");
const path = require("node:path");

const PROVIDERS = {
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    keyEnv: "GEMINI_API_KEY",
    claudeStyle: false,
  },
  zai: { label: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4", keyEnv: "ZAI_API_KEY", claudeStyle: false },
  qwen: { label: "Qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyEnv: "DASHSCOPE_API_KEY", claudeStyle: false },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", claudeStyle: false },
  claude: { label: "Claude", baseUrl: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY", claudeStyle: true },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", claudeStyle: false },
};

const CURATED_FIRST = {
  gemini: "gemini-2.5-flash",
  zai: "glm-4.7-flash",
  qwen: "qwen3-turbo",
  openai: "gpt-4.1-mini",
  claude: "claude-haiku-4-5",
  openrouter: "google/gemini-2.5-flash",
};

function mask(k) {
  return k ? `${k.slice(0, 4)}…${k.slice(-4)}(len ${k.length})` : "(none)";
}

async function probe(providerId, rawKey) {
  const p = PROVIDERS[providerId];
  console.log(`\n=== ${p.label} (${providerId}) key ${mask(rawKey)} ===`);

  // Catalog listing mirrors llm.listModels.
  try {
    const t0 = Date.now();
    const res = await fetch(p.modelsUrl || `${p.baseUrl}/models`, {
      headers: p.claudeStyle ? { "x-api-key": rawKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${rawKey}` },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`[catalog] HTTP ${res.status} in ${Date.now() - t0}ms`);
    if (!res.ok) console.log(`[catalog] body: ${text.slice(0, 500)}`);
  } catch (err) {
    console.log(`[catalog] failed: ${err.name} ${err.message}`);
  }

  // One minimal chat completion, same shape the pipeline sends.
  try {
    const t0 = Date.now();
    const headers = { "Content-Type": "application/json" };
    if (p.claudeStyle) Object.assign(headers, { "x-api-key": rawKey, "anthropic-version": "2023-06-01" });
    else Object.assign(headers, { Authorization: `Bearer ${rawKey}` });
    if (providerId === "qwen") headers["X-DashScope-workspace"] = undefined;
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: CURATED_FIRST[providerId],
        temperature: 0,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    console.log(`[chat] HTTP ${res.status} in ${Date.now() - t0}ms`);
    for (const [k, v] of res.headers) if (/retry-after|ratelimit|quota|remaining|reset/i.test(k)) console.log(`  hdr ${k}: ${v}`);
    if (!res.ok) console.log(`[chat] ERROR BODY: ${text.slice(0, 1200)}`);
    else {
      try {
        const j = JSON.parse(text);
        console.log(`  usage: ${JSON.stringify(j.usage || {})}`);
      } catch {}
    }
  } catch (err) {
    console.log(`[chat] failed: ${err.name} ${err.message}`);
  }
}

app.whenReady().then(async () => {
  try {
    // The real app runs as package "cadara", so its settings live here.
    app.setPath("userData", "/Users/pulakitbararia/Library/Application Support/cadara");
    console.log("safeStorage.isEncryptionAvailable:", safeStorage.isEncryptionAvailable());
    const settingsPath = path.join(app.getPath("userData"), "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    for (const [providerId, keys] of Object.entries(settings.apiKeys || {})) {
      for (const entry of keys.filter((k) => k.active)) {
        let raw = "";
        try {
          raw = safeStorage.decryptString(Buffer.from(entry.key, "base64"));
        } catch (err) {
          console.log(`\n=== ${providerId} (${entry.id}) decrypt FAILED: ${err.message}`);
          continue;
        }
        await probe(providerId, raw);
      }
    }
    console.log("\nDiagnostic complete.");
  } catch (err) {
    console.error("diag fatal:", err);
  } finally {
    app.quit();
    setTimeout(() => process.exit(0), 500);
  }
});
