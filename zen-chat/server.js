require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const PROVIDERS = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    keyEnv: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  groq: {
    id: "groq",
    label: "Groq",
    keyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    modelsUrl: "https://api.groq.com/openai/v1/models",
  },
};

const FALLBACK_MODELS = {
  gemini: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash"],
  groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b", "groq/compound-mini"],
};

const MODEL_INFO = {
  gemini: [
    { match: /3\.1.*flash-lite/i, tier: "free tier", price: "$0.25 / $1.50 per 1M tok", rank: 0 },
    { match: /3\.5.*flash-lite/i, tier: "free tier", price: "$0.30 / $2.50 per 1M tok", rank: 1 },
    { match: /3\.[67].*flash/i, tier: "free tier", price: "$0.75 / $3.75 per 1M tok through 2026", rank: 2 },
    { match: /3\.5.*flash/i, tier: "free tier", price: "$1.50 / $9.00 per 1M tok", rank: 3 },
    { match: /pro/i, tier: "paid", price: "premium, see Gemini pricing", rank: 4 },
  ],
  groq: [
    { match: /gpt-oss-?20b/i, tier: "free-tier friendly", price: "$0.075 / $0.30 per 1M tok", rank: 0 },
    { match: /gpt-oss-?120b/i, tier: "free-tier friendly", price: "$0.15 / $0.60 per 1M tok", rank: 1 },
    { match: /qwen\/qwen3-32b/i, tier: "free-tier friendly", price: "$0.29 / $0.59 per 1M tok", rank: 2 },
    { match: /qwen\/qwen3\.6-27b/i, tier: "paid", price: "$0.60 / $3.00 per 1M tok", rank: 3 },
    { match: /compound/i, tier: "paid/system", price: "see Groq pricing", rank: 5 },
  ],
};

const modelCache = new Map();

app.use(express.json());
app.use(express.static("public"));

function providerById(id) {
  return PROVIDERS[id] || null;
}

function keyFor(provider) {
  return process.env[provider.keyEnv] || "";
}

function modelInfo(providerId, modelId) {
  const rows = MODEL_INFO[providerId] || [];
  return rows.find((row) => row.match.test(modelId)) || { tier: "paid", price: "see provider pricing", rank: 9 };
}

function annotateModels(providerId, ids) {
  return [...new Set(ids)]
    .map((id) => {
      const info = modelInfo(providerId, id);
      return {
        id,
        tier: info.tier,
        price: info.price,
        rank: info.rank,
        label: `${id} - ${info.tier} - ${info.price}`,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

async function listModels(providerId, apiKey) {
  const provider = providerById(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const cacheKey = `${providerId}:${apiKey.slice(0, 16)}`;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);

  let ids = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    if (providerId === "gemini") {
      const res = await fetch(provider.modelsUrl, {
        headers: { "x-goog-api-key": apiKey },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => (m.name || "").replace(/^models\//, ""))
        .filter((id) => id && !/embedding|image|tts|veo|live|robotics|computer-use|antigravity|deep-research|lyria|banana|omni/i.test(id));
    } else {
      const res = await fetch(provider.modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.data || [])
        .map((m) => m.id)
        .filter((id) => id && !/whisper|tts|guard|embed|orpheus|safeguard/i.test(id));
    }
  } finally {
    clearTimeout(timer);
  }

  if (!ids.length) ids = FALLBACK_MODELS[providerId] || [];
  const catalog = annotateModels(providerId, ids);
  modelCache.set(cacheKey, catalog);
  return catalog;
}

async function defaultModel(providerId, apiKey) {
  const catalog = await listModels(providerId, apiKey);
  return catalog[0]?.id || FALLBACK_MODELS[providerId]?.[0] || "";
}

async function chatCompletion({ provider, apiKey, model, prompt }) {
  const body = {
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant. Be clear, practical, and concise." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  };
  if (provider.id === "groq" && /gpt-oss/i.test(model)) {
    body.reasoning_effort = "low";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw Object.assign(new Error(`${provider.label} timed out.`), { status: 504 });
    throw Object.assign(new Error(`Could not reach ${provider.label}. Check your connection.`), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || `${provider.label} returned HTTP ${res.status}`;
    throw Object.assign(new Error(String(detail)), { status: res.status >= 500 ? 502 : res.status });
  }

  const message = data.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content !== "string") {
    throw Object.assign(new Error(`${provider.label} returned an unexpected response.`), { status: 502 });
  }
  return content;
}

app.get("/api/models", async (_req, res) => {
  const providers = {};
  for (const provider of Object.values(PROVIDERS)) {
    const apiKey = keyFor(provider);
    providers[provider.id] = {
      label: provider.label,
      hasKey: Boolean(apiKey),
      models: apiKey ? await listModels(provider.id, apiKey).catch(() => annotateModels(provider.id, FALLBACK_MODELS[provider.id])) : [],
    };
  }
  res.json({
    defaultProvider: providerById(process.env.LLM_PROVIDER)?.id || "gemini",
    defaultModel: process.env.LLM_MODEL || "",
    providers,
  });
});

app.post("/api/chat", async (req, res) => {
  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "The 'prompt' field must be a non-empty string." });
  }

  const providerId = req.body.provider || process.env.LLM_PROVIDER || "gemini";
  const provider = providerById(providerId);
  if (!provider) return res.status(400).json({ error: "Choose Gemini or Groq." });

  const apiKey = keyFor(provider);
  if (!apiKey) {
    return res.status(500).json({ error: `${provider.keyEnv} is not set. Add it to your .env file.` });
  }

  let model = req.body.model || process.env.LLM_MODEL || "";
  try {
    if (!model) model = await defaultModel(provider.id, apiKey);
    const response = await chatCompletion({ provider, apiKey, model, prompt: prompt.trim() });
    return res.json({ response, provider: provider.id, model });
  } catch (err) {
    console.error(`${provider.label} API error:`, err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Gemini/Groq Chat running at http://${HOST}:${PORT}`);
});
