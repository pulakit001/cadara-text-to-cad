import "dotenv/config";

// Multi-provider LLM client. Gemini, Groq, and OpenAI use OpenAI-compatible
// chat endpoints here; Claude uses Anthropic's Messages API behind a small
// adapter so the CAD agent can keep one tool-calling contract.

export const PROVIDERS = {
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    settingsKey: "groqApiKey",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    settingsKey: "geminiApiKey",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    settingsKey: "openaiApiKey",
  },
  claude: {
    id: "claude",
    label: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    settingsKey: "claudeApiKey",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    settingsKey: "openrouterApiKey",
  },
};

export function providerById(id) {
  return PROVIDERS[id] || null;
}

export function modelSupportsVision(providerId, modelId = "") {
  if (!modelId) return false;
  if (providerId === "gemini") {
    return /^gemini-/i.test(modelId) && !/embedding|image|tts|veo|live|robotics|computer-use|antigravity|deep-research|lyria|banana|omni/i.test(modelId);
  }
  if (providerId === "groq") {
    return /vision|llama-4|maverick|scout|llava|pixtral/i.test(modelId);
  }
  if (providerId === "openai") {
    return /gpt-[45]|o[34]|vision|omni/i.test(modelId) && !/audio|realtime|image|tts|transcribe|embed/i.test(modelId);
  }
  if (providerId === "claude") {
    return /^claude-/i.test(modelId) && !/embed/i.test(modelId);
  }
  if (providerId === "openrouter") {
    return /gemini|gpt-[45]|claude-3-5-sonnet|claude-sonnet-4|pixtral/i.test(modelId);
  }
  return false;
}

function messagesContainImage(messages = []) {
  return messages.some((message) =>
    Array.isArray(message.content) &&
    message.content.some((part) => part?.type === "image_url")
  );
}

export class LLMRateLimitError extends Error {
  constructor(message = "This model is rate-limited right now. Try again in a moment or pick another model.") {
    super(message);
    this.name = "LLMRateLimitError";
    this.rateLimited = true;
  }
}

export class LLMConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export class LLMModelError extends Error {
  constructor(model, providerLabel) {
    super(`${model} is not available on ${providerLabel}; switching models.`);
    this.name = "LLMModelError";
  }
}

// Price annotations are per 1M input/output tokens, USD. The APIs don't
// expose pricing, so this table is maintained by hand; unknown models fall
// back to a generic paid note.
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
  openai: [
    { match: /gpt-5-nano/i, tier: "efficient", price: "lowest OpenAI cost tier", rank: 0 },
    { match: /gpt-5-mini/i, tier: "balanced", price: "lower cost than flagship GPT-5", rank: 1 },
    { match: /^gpt-5$/i, tier: "premium", price: "flagship OpenAI tier", rank: 2 },
    { match: /gpt-5-pro/i, tier: "ultra", price: "highest OpenAI quality tier", rank: 3 },
    { match: /gpt-4\.1-mini|gpt-4o-mini/i, tier: "efficient", price: "low OpenAI cost tier", rank: 4 },
  ],
  claude: [
    { match: /haiku/i, tier: "efficient", price: "lowest Claude cost tier", rank: 0 },
    { match: /sonnet/i, tier: "balanced", price: "mid Claude cost tier", rank: 1 },
    { match: /opus/i, tier: "ultra", price: "highest Claude quality tier", rank: 2 },
  ],
  openrouter: [
    { match: /haiku|mini|flash/i, tier: "efficient", price: "low cost tier", rank: 0 },
    { match: /sonnet|gpt-4\.1|llama-3\.3-70b/i, tier: "balanced", price: "mid cost tier", rank: 1 },
    { match: /opus|gpt-5|gemini-.*-pro/i, tier: "ultra", price: "premium tier", rank: 2 },
  ],
};

export const MODEL_PACKETS = {
  gemini: [
    {
      id: "gemini-free",
      label: "Gemini Free",
      cost: "lowest",
      priceNote: "Starts with Flash Lite / free-tier friendly models.",
      description: "Fastest cheap default for simple CAD blocks, holes, plates, brackets, and quick retries.",
      preferredModels: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"],
    },
    {
      id: "gemini-efficient",
      label: "Gemini Efficient",
      cost: "low",
      priceNote: "Small cost increase for better planning reliability.",
      description: "Balanced everyday CAD preset: still fast, better at measurements, constraints, and image references.",
      preferredModels: ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-2.5-flash"],
    },
    {
      id: "gemini-paid",
      label: "Gemini Paid",
      cost: "medium",
      priceNote: "Uses stronger paid Gemini models when available.",
      description: "Better for multi-feature parts, spec cleanup, and fewer build/review repair loops.",
      preferredModels: ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-pro-latest"],
    },
    {
      id: "gemini-ultra",
      label: "Ultra Gemini",
      cost: "highest",
      priceNote: "Highest Gemini quality/cost in the available catalog.",
      description: "Use when accuracy matters more than cost: complex geometry, dense reference images, and hard constraints.",
      preferredModels: ["gemini-pro-latest", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
    },
  ],
  groq: [
    {
      id: "groq-efficient",
      label: "Groq Efficient",
      cost: "lowest",
      priceNote: "Lowest-cost Groq console preset.",
      description: "Very fast text-only CAD generation for simple parts and cheap retry loops.",
      preferredModels: ["openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    },
    {
      id: "groq-performance",
      label: "Groq Performance",
      cost: "low-medium",
      priceNote: "Costs more than Efficient, usually stronger reasoning.",
      description: "Better for measurements, build instructions, and reviewer corrections while staying fast.",
      preferredModels: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "llama-3.3-70b-versatile"],
    },
    {
      id: "groq-ultra",
      label: "Ultra Groq Console",
      cost: "highest",
      priceNote: "Uses Groq's strongest available console model/system route.",
      description: "Best Groq option for difficult text-only CAD prompts where quality beats raw thrift.",
      preferredModels: ["groq/compound", "groq/compound-mini", "qwen/qwen3.6-27b", "openai/gpt-oss-120b"],
    },
  ],
  openai: [
    {
      id: "openai-efficient",
      label: "OpenAI Efficient",
      cost: "lowest",
      priceNote: "Lowest OpenAI preset when an OpenAI key is added.",
      description: "Cheap, quick tool-calling for simple CAD tasks and frequent iteration.",
      preferredModels: ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
    },
    {
      id: "openai-performance",
      label: "OpenAI Performance",
      cost: "medium",
      priceNote: "Higher cost for stronger CAD reasoning.",
      description: "Better constraint following, tool use, reference-image interpretation, and repair planning.",
      preferredModels: ["gpt-5-mini", "gpt-5", "gpt-4.1"],
    },
    {
      id: "openai-ultra",
      label: "OpenAI Ultra",
      cost: "highest",
      priceNote: "Highest OpenAI quality/cost preset.",
      description: "Use for the hardest prompts, strict specs, and complex images.",
      preferredModels: ["gpt-5-pro", "gpt-5", "gpt-4.1"],
    },
  ],
  claude: [
    {
      id: "claude-efficient",
      label: "Claude Efficient",
      cost: "lowest",
      priceNote: "Lowest Claude preset when an Anthropic key is added.",
      description: "Cheap drafting and spec cleanup for straightforward CAD requests.",
      preferredModels: ["claude-haiku-4-5", "claude-3-5-haiku-latest"],
    },
    {
      id: "claude-performance",
      label: "Claude Performance",
      cost: "medium",
      priceNote: "Higher cost, stronger planning and review.",
      description: "Good for precise natural-language interpretation and careful multi-step CAD plans.",
      preferredModels: ["claude-sonnet-4-5", "claude-sonnet-4-0", "claude-3-7-sonnet-latest"],
    },
    {
      id: "claude-ultra",
      label: "Claude Ultra",
      cost: "highest",
      priceNote: "Highest Claude quality/cost preset.",
      description: "Use for the most complex specs and image-guided CAD reasoning.",
      preferredModels: ["claude-opus-4-1", "claude-opus-4-0", "claude-3-opus-latest"],
    },
  ],
  openrouter: [
    {
      id: "or-efficient",
      label: "OR Efficient",
      cost: "lowest",
      priceNote: "Low cost models via OpenRouter.",
      description: "Cheap drafting and simple CAD generation.",
      preferredModels: ["google/gemini-2.5-flash", "anthropic/claude-haiku-4-5", "openai/gpt-4.1-mini"],
    },
    {
      id: "or-performance",
      label: "OR Performance",
      cost: "medium",
      priceNote: "Balanced cost and capability.",
      description: "Strong CAD reasoning from flagship tier models.",
      preferredModels: ["anthropic/claude-sonnet-4", "meta-llama/llama-3.3-70b-instruct", "qwen/qwen3-32b", "openai/gpt-4.1"],
    },
    {
      id: "or-ultra",
      label: "OR Ultra",
      cost: "highest",
      priceNote: "Premium models via OpenRouter.",
      description: "Complex logic and geometry.",
      preferredModels: ["google/gemini-2.5-pro", "anthropic/claude-opus-4-1"],
    },
  ],
};

function modelInfo(providerId, modelId) {
  const table = MODEL_INFO[providerId] || [];
  for (const row of table) {
    if (row.match.test(modelId)) return row;
  }
  return { tier: "paid", price: "see provider pricing", rank: 9 };
}

const modelCache = new Map();

function annotate(providerId, ids) {
  return ids
    .map((id) => {
      const info = modelInfo(providerId, id);
      return {
        id,
        label: `${id} — ${info.tier} · ${info.price}`,
        tier: info.tier,
        price: info.price,
        rank: info.rank,
        supportsVision: modelSupportsVision(providerId, id),
      };
    })
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

export function listModelPackets(providerId, catalog = []) {
  const providerPackets = MODEL_PACKETS[providerId] || [];
  const availableIds = new Set((catalog || []).map((m) => m.id));
  const hasLiveCatalog = availableIds.size > 0;
  return providerPackets
    .map((packet) => {
      const model = packet.preferredModels.find((id) => !hasLiveCatalog || availableIds.has(id));
      if (!model) return null;
      const info = (catalog || []).find((m) => m.id === model) || annotate(providerId, [model])[0];
      return {
        id: packet.id,
        label: packet.label,
        cost: packet.cost,
        priceNote: packet.priceNote,
        description: packet.description,
        model,
        modelLabel: info?.label || model,
        supportsVision: Boolean(info?.supportsVision),
      };
    })
    .filter(Boolean);
}

// Live model catalog, cheapest tiers first. Cached per provider for the
// process lifetime; a failed fetch falls back to a small known-good list.
export async function listModels(providerId, apiKey) {
  const provider = providerById(providerId);
  if (!provider) throw new LLMConfigError(`Unknown provider: ${providerId}`);
  const cacheKey = `${providerId}:${apiKey ? apiKey.slice(0, 16) : "nokey"}`;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);

  let ids = [];
  try {
    if (providerId === "gemini") {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => (m.name || "").replace(/^models\//, ""))
        .filter((id) => /gemini-2\.5|gemini-3\.[1567]/i.test(id) && !/embedding|image|tts|veo|live|robotics|computer-use|antigravity|deep-research|lyria|banana|omni/i.test(id));
    } else if (providerId === "claude") {
      const res = await fetch(`${provider.baseUrl}/models`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.data || [])
        .map((m) => m.id)
        .filter((id) => /claude-(haiku|sonnet|opus)-4|claude-3-5-haiku-latest|claude-3-7-sonnet-latest|claude-3-opus-latest/i.test(id));
    } else {
      const res = await fetch(`${provider.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.data || [])
        .map((m) => m.id)
        .filter((id) => {
          if (providerId === "groq") {
            return /llama-3\.3-70b-versatile|qwen3-32b|qwen3\.6-27b|gpt-oss-120b/i.test(id);
          }
          if (providerId === "openai") {
            return /gpt-4\.1|gpt-4o|gpt-5/i.test(id) && !/audio|realtime|image|tts|transcribe|embed/i.test(id);
          }
          if (providerId === "openrouter") {
            return /google\/gemini-2\.5|anthropic\/claude-sonnet-4|anthropic\/claude-haiku-4-5|openai\/gpt-4\.1|meta-llama\/llama-3\.3-70b-instruct|qwen\/qwen3-32b/i.test(id);
          }
          return !/whisper|tts|guard|embed|distil-whisper|orpheus|safeguard/i.test(id);
        });
    }
  } catch {
    ids = [];
  }

  const FALLBACK = {
    groq: ["llama-3.3-70b-versatile", "qwen/qwen3.6-27b", "openai/gpt-oss-120b"],
    gemini: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-5-nano", "gpt-5-mini", "gpt-5"],
    claude: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1", "claude-sonnet-4-0", "claude-3-5-haiku-latest"],
    openrouter: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"],
  };
  if (!ids.length) ids = FALLBACK[providerId] || [];

  const catalog = annotate(providerId, ids);
  modelCache.set(cacheKey, catalog);
  return catalog;
}

export class LLM {
  constructor({ provider: providerId, apiKey, model, timeoutMs = 180000 } = {}) {
    const provider = providerById(providerId);
    if (!provider) throw new LLMConfigError(`Unknown provider: ${providerId}`);
    this.providerId = providerId;
    this.provider = provider;
    this.apiKey = apiKey || process.env[provider.keyEnv];
    this.model = model;
    this.timeoutMs = timeoutMs;
    if (!this.apiKey || /your-key-here/i.test(this.apiKey)) {
      throw new LLMConfigError(
        `${provider.label} API key is not set. Add ${provider.keyEnv} to .env or paste it in Settings.`
      );
    }
  }

  async chat({ messages, tools = null, temperature = 0.4 }) {
    const hasImage = messagesContainImage(messages);
    if (!this.model) {
      const fullCatalog = await listModels(this.providerId, this.apiKey);
      const catalog = hasImage ? fullCatalog.filter((m) => m.supportsVision) : fullCatalog;
      if (!catalog.length) throw new LLMConfigError("No models available for this provider.");
      this.model = catalog[0].id;
    }
    if (hasImage && !modelSupportsVision(this.providerId, this.model)) {
      throw new LLMConfigError(`${this.model} does not support image input. Pick a vision-capable model or remove the reference image.`);
    }

    const body = { messages, temperature, model: this.model };
    if (tools && tools.length) body.tools = tools;
    if (this.providerId === "groq" && /gpt-oss/i.test(this.model)) {
      body.reasoning_effort = "low";
      body.max_tokens = 4096;
    }

    let attempt = 1;
    let timeouts = 0;
    const maxAttempts = 4;

    while (attempt <= maxAttempts) {
      try {
        const message = await this.requestChat(body);
        return message;
      } catch (err) {
        const retryable =
          err.name === "LLMTransientError" ||
          err.name === "LLMServerError" ||
          err.name === "LLMTimeoutError" ||
          err.name === "LLMModelError" ||
          err instanceof LLMRateLimitError;
        if (!retryable || attempt === maxAttempts) throw err;
        if (err.name === "LLMTimeoutError" && ++timeouts >= 3) throw err;

        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        attempt++;
      }
    }
  }

  async requestChat(body) {
    if (this.providerId === "claude") return this.requestClaudeChat(body);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(`${this.provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        const timeout = new Error(
          `${this.provider.label} took too long to respond. Try again or pick another model.`
        );
        timeout.name = "LLMTimeoutError";
        throw timeout;
      }
      const transient = new Error(`Could not reach ${this.provider.label}. Check your connection.`);
      transient.name = "LLMTransientError";
      throw transient;
    }
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    const errType = data?.error?.type || "";
    const errMsg = data?.error?.message || "";

    if (res.status === 401 || res.status === 403) {
      if (/model.*(not support|not found|does not exist)|unsupported model/i.test(errMsg)) {
        throw new LLMModelError(body.model, this.provider.label);
      }
      throw new LLMConfigError(`Invalid ${this.provider.label} API key. Update it in Settings.`);
    }
    if (res.status === 404) throw new LLMModelError(body.model, this.provider.label);
    if (res.status === 429) throw new LLMRateLimitError();
    if (res.status >= 500) {
      const serverErr = new Error(`${this.provider.label} server error (HTTP ${res.status}). Retrying...`);
      serverErr.name = "LLMServerError";
      throw serverErr;
    }

    if (!res.ok) {
      const detail = errMsg || errType || `${this.provider.label} error (HTTP ${res.status})`;
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      if (res.status >= 400 && res.status < 500) throw err;
      err.name = "LLMTransientError";
      throw err;
    }

    const message = data.choices?.[0]?.message;
    if (!message) {
      const empty = new Error(`${this.provider.label} returned an empty response. Retrying...`);
      empty.name = "LLMTransientError";
      throw empty;
    }
    // Groq exposes reasoning as message.reasoning on thinking models.
    if (!message.reasoning_content && typeof message.reasoning === "string") {
      message.reasoning_content = message.reasoning;
    }
    return message;
  }

  async requestClaudeChat(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(`${this.provider.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(toClaudeBody(body)),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        const timeout = new Error(
          `${this.provider.label} took too long to respond. Try again or pick another model.`
        );
        timeout.name = "LLMTimeoutError";
        throw timeout;
      }
      const transient = new Error(`Could not reach ${this.provider.label}. Check your connection.`);
      transient.name = "LLMTransientError";
      throw transient;
    }
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    const errType = data?.error?.type || "";
    const errMsg = data?.error?.message || "";

    if (res.status === 401 || res.status === 403) {
      throw new LLMConfigError(`Invalid ${this.provider.label} API key. Update it in Settings.`);
    }
    if (res.status === 404) throw new LLMModelError(body.model, this.provider.label);
    if (res.status === 429) throw new LLMRateLimitError();
    if (res.status >= 500) {
      const serverErr = new Error(`${this.provider.label} server error (HTTP ${res.status}). Retrying...`);
      serverErr.name = "LLMServerError";
      throw serverErr;
    }
    if (!res.ok) {
      const detail = errMsg || errType || `${this.provider.label} error (HTTP ${res.status})`;
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      if (/model.*(not support|not found|does not exist)|unsupported model/i.test(err.message)) {
        throw new LLMModelError(body.model, this.provider.label);
      }
      throw err;
    }

    return fromClaudeMessage(data, this.provider.label);
  }
}

function dataUrlToClaudeImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) return null;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1],
      data: match[2],
    },
  };
}

function openAiContentToClaude(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part?.type === "text") return { type: "text", text: String(part.text || "") };
        if (part?.type === "image_url") return dataUrlToClaudeImage(part.image_url?.url);
        return null;
      })
      .filter(Boolean);
  }
  return [{ type: "text", text: String(content || "") }];
}

function toClaudeBody(body) {
  const messages = [];
  let system = "";
  for (const message of body.messages || []) {
    if (message.role === "system") {
      system += (system ? "\n\n" : "") + String(message.content || "");
      continue;
    }
    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: String(message.content || ""),
        }],
      });
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const content = [];
      if (message.content) content.push({ type: "text", text: String(message.content) });
      for (const call of message.tool_calls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.function?.name,
          input: JSON.parse(call.function?.arguments || "{}"),
        });
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: openAiContentToClaude(message.content),
    });
  }

  const out = {
    model: body.model,
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature ?? 0.4,
    messages,
  };
  if (system) out.system = system;
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || "",
      input_schema: tool.function.parameters || { type: "object", properties: {} },
    }));
  }
  return out;
}

function fromClaudeMessage(data, providerLabel) {
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  const toolCalls = blocks
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      type: "function",
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input || {}),
      },
    }));

  if (!text && !toolCalls.length) {
    const empty = new Error(`${providerLabel} returned an empty response. Retrying...`);
    empty.name = "LLMTransientError";
    throw empty;
  }
  return {
    role: "assistant",
    content: text,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}
