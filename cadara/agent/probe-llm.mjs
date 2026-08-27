/**
 * @file probe-llm.mjs
 * @description Diagnostic probe for rate-limit investigation. Mirrors the exact
 * request path of llm.mjs (same endpoint, headers, model auto-selection) and
 * prints HTTP status, latency, rate-limit headers, and full error bodies so a
 * 429 shows its real reason (RPM vs TPM vs per-day quota).
 *
 * Usage: node agent/probe-llm.mjs [providerId] [--burst N]
 * Makes at most 1 catalog call + 1 chat call by default (burst adds more,
 * spaced 1.5s apart) so running this never meaningfully drains quota.
 */

import "dotenv/config";

const PROVIDERS = {
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    keyEnv: "GEMINI_API_KEY",
  },
  zai: { label: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4", keyEnv: "ZAI_API_KEY", curated: true },
  qwen: { label: "Qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyEnv: "DASHSCOPE_API_KEY", curated: true },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  claude: { label: "Claude", baseUrl: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
};

const CURATED = {
  zai: ["glm-4.7-flash", "glm-4.5-air", "glm-4.7"],
  qwen: ["qwen3-turbo", "qwen-turbo", "qwen3-plus"],
};
const FALLBACK_FIRST_MODEL = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4.1-mini",
  claude: "claude-haiku-4-5",
  openrouter: "google/gemini-2.5-flash",
};

const args = process.argv.slice(2);
const burstIdx = args.indexOf("--burst");
const burst = burstIdx >= 0 ? Math.max(1, parseInt(args[burstIdx + 1] || "1", 10)) : 1;
if (burstIdx >= 0) args.splice(burstIdx, 2);
const providerId = args[0] || process.env.LLM_PROVIDER || "gemini";
const provider = PROVIDERS[providerId];
if (!provider) {
  console.error(`Unknown provider "${providerId}".`);
  process.exit(1);
}
const apiKey = process.env[provider.keyEnv];
if (!apiKey) {
  console.error(`${provider.keyEnv} not set — nothing to probe.`);
  process.exit(1);
}
console.log(`Probing ${provider.label} (${provider.keyEnv}: ...${apiKey.slice(-4)}, len ${apiKey.length})`);

function headers(providerId) {
  const h = { Authorization: `Bearer ${apiKey}` };
  if (providerId === "claude") {
    delete h.Authorization;
    h["x-api-key"] = apiKey;
    h["anthropic-version"] = "2023-06-01";
  }
  return h;
}

// --- Step 1: model catalog (what listModels does) ---
let modelId = provider.curated ? CURATED[providerId][0] : null;
if (!modelId && providerId !== "claude") {
  const url =
    providerId === "gemini"
      ? `${provider.modelsUrl}?pageSize=200`
      : providerId === "openrouter"
        ? `${provider.baseUrl}/models`
        : `${provider.baseUrl}/models`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: headers(providerId), signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  console.log(`\n[catalog] GET models -> HTTP ${res.status} in ${Date.now() - t0}ms`);
  for (const [k, v] of res.headers) if (/retry-after|ratelimit|quota/i.test(k)) console.log(`[catalog hdr] ${k}: ${v}`);
  if (!res.ok) {
    console.log(`[catalog body] ${text.slice(0, 800)}`);
  } else {
    try {
      const data = JSON.parse(text);
      let ids =
        providerId === "gemini"
          ? (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name || "").replace(/^models\//, "")).filter((id) => /gemini-(2\.5|3)/i.test(id))
          : (data.data || []).map((m) => m.id);
      console.log(`[catalog] ${ids.length} candidate models; first:`, ids.slice(0, 6));
      modelId = ids[0] || FALLBACK_FIRST_MODEL[providerId];
    } catch {
      console.log("[catalog] non-JSON body:", text.slice(0, 400));
      modelId = FALLBACK_FIRST_MODEL[providerId];
    }
  }
}
if (providerId === "claude") {
  const t0 = Date.now();
  const res = await fetch(`${provider.baseUrl}/models`, { headers: headers(providerId), signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  console.log(`[catalog] HTTP ${res.status} in ${Date.now() - t0}ms`);
  modelId = (data.data || []).map((m) => m.id)[0] || FALLBACK_FIRST_MODEL.claude;
}
console.log(`\nUsing model: ${modelId}\n`);

// --- Step 2: minimal chat call(s), exactly like requestChat() ---
for (let i = 0; i < burst; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers(providerId) },
      body: JSON.stringify({
        model: modelId,
        temperature: 0,
        max_tokens: 16,
        messages: [{ role: "user", content: `Reply with exactly: OK-${i + 1}` }],
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    console.log(`[chat ${i + 1}/${burst}] network failure after ${Date.now() - t0}ms: ${err.name} ${err.message}`);
    continue;
  }
  const latency = Date.now() - t0;
  const text = await res.text();
  console.log(`[chat ${i + 1}/${burst}] HTTP ${res.status} in ${latency}ms`);
  for (const [k, v] of res.headers) {
    if (/retry-after|ratelimit|quota|remaining|reset/i.test(k)) console.log(`  hdr ${k}: ${v}`);
  }
  if (res.ok) {
    try {
      const j = JSON.parse(text);
      console.log(`  usage:`, JSON.stringify(j.usage || {}));
      console.log(`  reply:`, JSON.stringify(j.choices?.[0]?.message?.content ?? "").slice(0, 120));
    } catch {}
  } else {
    // Full 429/error body — this is where the REAL rate-limit reason lives.
    console.log(`  ERROR BODY: ${text.slice(0, 1600)}`);
  }
}
console.log("\nProbe complete.");
