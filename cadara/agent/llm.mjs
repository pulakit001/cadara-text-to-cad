import "dotenv/config";
import fs from "node:fs";

// Multi-provider LLM client. Gemini, Z.AI, Qwen, and OpenAI use
// OpenAI-compatible chat endpoints here; Claude uses Anthropic's Messages
// API behind a small adapter so the CAD agent can keep one tool-calling
// contract.

export const PROVIDERS = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    settingsKey: "geminiApiKey",
  },
  zai: {
    id: "zai",
    label: "Z.AI",
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyEnv: "ZAI_API_KEY",
    settingsKey: "zaiApiKey",
  },
  qwen: {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    keyEnv: "DASHSCOPE_API_KEY",
    settingsKey: "qwenApiKey",
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
  // Fully local inference via Ollama (https://ollama.com). Same
  // OpenAI-compatible contract as the cloud providers above — tool calling,
  // vision, and /v1/models all work against http://localhost:11434/v1. No
  // real API key exists; "ollama" is the conventional ignored placeholder.
  ollama: {
    id: "ollama",
    label: "Ollama (Local)",
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
    keyEnv: "OLLAMA_API_KEY",
    settingsKey: "ollamaApiKey",
    local: true,
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
  if (providerId === "zai") {
    // GLM-4.5V/GLM-4.6V vision variants; base glm-4.6+ are multimodal too.
    return /vision|^glm-[45]\.?[0-9]*v/i.test(modelId) || /^glm-4\.6$|^glm-4\.5$|^glm-4\.7$|^glm-5/i.test(modelId);
  }
  if (providerId === "qwen") {
    // DashScope text models here are text-in/text-out; the qwen-vl family
    // handles images but is not offered for this CAD pipeline.
    return false;
  }
  if (providerId === "openai") {
    return /gpt-[45]|o[34]|vision|omni/i.test(modelId) && !/audio|realtime|image|tts|transcribe|embed/i.test(modelId);
  }
  if (toolSupportingClaude(providerId, modelId)) {
    return true;
  }
  if (providerId === "openrouter") {
    return /gemini|gpt-|claude-|pixtral/i.test(modelId);
  }
  if (providerId === "ollama") {
    // Vision-capable local families: Qwen-VL, LLaVA, Gemma 3+, MiniCPM-V,
    // and anything explicitly named vision.
    return /(^|[-_:])vl\b|vision|llava|gemma|minicpm|moondream/i.test(modelId);
  }
  return false;
}

// Claude model ids all support vision; kept as a named guard so the
// openrouter branch above stays readable.
function toolSupportingClaude(providerId, modelId) {
  return providerId === "claude" && /^claude-/i.test(modelId) && !/embed/i.test(modelId);
}

function messagesContainImage(messages = []) {
  return messages.some((message) =>
    Array.isArray(message.content) &&
    message.content.some((part) => part?.type === "image_url")
  );
}

export class LLMRateLimitError extends Error {
  constructor(
    message = "This model is rate-limited right now. Try again in a moment or pick another model.",
    retryAfterMs = null,
    info = {}
  ) {
    super(message);
    this.name = "LLMRateLimitError";
    this.rateLimited = true;
    this.retryAfterMs = retryAfterMs;
    // Structured quota facts parsed from the provider's error body:
    // "minute" limits can be waited out mid-run; "day"/"account"/null scopes
    // with long Retry-After windows cannot, so callers must escalate fast.
    this.quotaScope = info.quotaScope || null;
    this.quotaReason = info.quotaReason || "";
    this.providerDetail = info.providerDetail || "";
    this.unwaitable =
      this.quotaScope === "day" ||
      this.quotaScope === "account" ||
      (this.retryAfterMs != null && this.retryAfterMs > RATE_LIMIT_WAITABLE_CEILING_MS);
  }
}

// Extracts structured quota facts from provider error bodies so the app can
// distinguish a per-minute blip (worth waiting out) from an exhausted daily
// pool or empty account balance (never worth waiting for inside this run).
export function describeRateLimitBody(status, bodyText) {
  const out = { retryAfterMs: null, quotaScope: null, quotaReason: "", detail: "" };
  let data = null;
  try {
    data = JSON.parse(String(bodyText || ""));
  } catch { }
  const err = data?.error || {};
  out.detail = String(err.message || "").slice(0, 500);
  const details = Array.isArray(err.details) ? err.details : [];
  for (const d of details) {
    const type = String(d["@type"] || "");
    if (/RetryInfo/.test(type)) {
      const secs =
        typeof d.retryDelay === "string" && /^(\d+(?:\.\d+)?)s$/.test(d.retryDelay)
          ? parseFloat(d.retryDelay)
          : Number.isFinite(d.retryDelay)
            ? Number(d.retryDelay)
            : NaN;
      if (Number.isFinite(secs)) out.retryAfterMs = Math.round(secs * 1000);
    }
    if (/QuotaFailure|ErrorInfo/.test(type)) {
      for (const v of d.violations || []) {
        const metric = String(v.quotaMetric || v.subject || v.description || "");
        if (/PerDay/i.test(metric)) out.quotaScope = "day";
        else if (!out.quotaScope && /(PerMinute|\bRPM\b)/i.test(metric)) out.quotaScope = "minute";
        if (!out.quotaReason && metric) out.quotaReason = metric.slice(0, 200);
      }
      if (typeof d.quotaId === "string" && /PerDay/i.test(d.quotaId)) out.quotaScope = "day";
    }
  }
  // Message heuristics cover OpenAI-compatible providers without structured
  // quota payloads (OpenRouter, DashScope, Z.AI …).
  if (!out.quotaScope) {
    const m = out.detail;
    // Empty wallet / credit preflight failures first — these look like plain
    // HTTP 400s but nothing time-based can fix them.
    if (/requires more credits|can only afford|insufficient credits/i.test(m)) {
      out.quotaScope = "account";
    } else if (/per[\s_-]?day|\bexisting monthly|\bdaily\b|(?:requests?|tokens?)\s*per\s*day/i.test(m)) {
      out.quotaScope = "day";
    } else if (/quota.*(exhausted|exceeded).*(day|monthly)|out of free (credits|requests)/i.test(m)) {
      out.quotaScope = "day";
    } else if (/(insufficient|no more)\s+(credits?|balance|funds?)|monthly limit/i.test(m)) {
      out.quotaScope = "account";
    } else if (/rate.?limit.*(exceed|hit)|too many requests/i.test(m)) {
      out.quotaScope = "minute";
    }
  }
  return out;
}

// "Retry-After" headers are seconds or an HTTP date; return ms or null.
export function parseRetryAfterMs(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return parseInt(text, 10) * 1000;
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

const RATE_LIMIT_BASE_DELAY_MS = 1000;
// A single wait never exceeds this, and the total time an LLM instance spends
// waiting out rate limits is budgeted (rateLimitBudgetMs) — after the budget
// is spent the error propagates and the job falls back to another provider.
const RATE_LIMIT_MAX_DELAY_MS = 30000;
// A rate limit with a window longer than this can't be waited out inside a
// run (daily caps reset in hours): retrying would burn quota-delayed minutes,
// so the error escalates immediately to the next provider / final message.
const RATE_LIMIT_WAITABLE_CEILING_MS = 120000;
// Consecutive instant 429s (no Retry-After header, no scope hint) on one
// model before advancing to the next ranked candidate. Covers free/shared
// routes that answer bare 429s without any server-provided timing.
const RATE_LIMIT_STREAK_ESCALATE = 3;
// Process-wide breaker state per `${providerId}|${model}` route. Lives at
// module level ON PURPOSE: pipeline phases call llm.chat() separately (and
// sometimes construct fresh LLM instances), so per-call counters reset and
// doom-loops repeat. Entries expire so a recovered route is retried later.
const ROUTE_FAIL_TTL_MS = 60000;
const routeFailStreak = new Map(); // key -> { count, updatedAt }
function routeFailRecord(providerId, modelId) {
  const key = `${providerId}|${modelId}`;
  const rec = routeFailStreak.get(key);
  const fresh = rec && Date.now() - rec.updatedAt < ROUTE_FAIL_TTL_MS;
  return { key, rec: fresh ? rec : null };
}
// A model whose breaker is open must be skipped by auto-selection entirely.
export function routeIsBroken(providerId, modelId) {
  const { rec } = routeFailRecord(providerId, modelId);
  return Boolean(rec && rec.count >= RATE_LIMIT_STREAK_ESCALATE);
}
// After a catalog fetch fails (bad key, network), don't re-hit the provider
// for every stage/send within this window — fall straight to FALLBACK ids.
const CATALOG_FAILURE_TTL_MS = 120000;
const catalogFailures = new Map(); // key -> epoch ms of last failed fetch

export function canceledError() {
  const err = new Error("canceled");
  err.name = "JobCanceledError";
  return err;
}

// Sleeps that wake immediately when the job is canceled, so a cancel click
// never waits out a backoff delay.
function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(canceledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(canceledError());
    }
    signal?.addEventListener("abort", onAbort);
  });
}

// Exponential backoff for 429s: 1s, 2s, 4s … capped at RATE_LIMIT_MAX_DELAY_MS.
// A server-provided Retry-After always wins (capped so a bad header can't stall a run).
export function rateLimitBackoffMs(attempt, retryAfterMs = null, scale = 1) {
  const exponential = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), RATE_LIMIT_MAX_DELAY_MS);
  return Math.round(Math.max(0, retryAfterMs != null ? Math.min(retryAfterMs, RATE_LIMIT_MAX_DELAY_MS) : exponential) * scale);
}

export class LLMConfigError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "LLMConfigError";
    // Provider-hoppable failure (e.g. the key authenticates badly) — lets
    // main.js fall through to the next configured provider automatically.
    this.fallbackable = Boolean(opts.fallbackable);
  }
}

export class LLMModelError extends Error {
  constructor(model, providerLabel) {
    super(`${model} is not available on ${providerLabel}; switching models.`);
    this.name = "LLMModelError";
  }
}

// A whole-run safety clock: when the deadline passes, every remaining stage
// aborts instead of queueing more slow calls. Never retried automatically.
export class LLMDeadlineError extends Error {
  constructor(message = "This run hit its time limit — providers are slow or out of quota right now. Send again shortly.") {
    super(message);
    this.name = "LLMDeadlineError";
  }
}

// Price annotations are per 1M input/output tokens, USD. The APIs don't
// expose pricing, so this table is maintained by hand; unknown models fall
// back to a generic paid note.
//
// Ranks order each provider's dropdown free-tier-first, then best value for
// CAD (reliable tool calling per token) → premium extremes → budget legacy,
// with unclassified models last. Lower rank = higher in the list.
const MODEL_INFO = {
  gemini: [
    // Free tier first, strongest Flash variants before weaker ones.
    { match: /3\.7.*flash(?!-lite)/i, tier: "free tier", price: "$0.75 / $3.75 per 1M tok through 2026", rank: 0 },
    { match: /3\.6.*flash(?!-lite)/i, tier: "free tier", price: "$0.75 / $3.75 per 1M tok through 2026", rank: 1 },
    { match: /2\.5.*flash(?!-lite)/i, tier: "free tier", price: "$0.30 / $2.50 per 1M tok", rank: 2 },
    { match: /3\.5.*flash(?!-lite)/i, tier: "free tier", price: "$1.50 / $9.00 per 1M tok", rank: 3 },
    // Paid Pro tiers next.
    { match: /pro/i, tier: "paid", price: "premium, see Gemini pricing", rank: 10 },
    // Flash Lite last among free: cheapest but weakest for CAD tool loops.
    { match: /3\.5.*flash-lite/i, tier: "free tier", price: "$0.30 / $2.50 per 1M tok", rank: 20 },
    { match: /3\.1.*flash-lite/i, tier: "free tier", price: "$0.25 / $1.50 per 1M tok", rank: 21 },
    { match: /flash-lite/i, tier: "free tier", price: "$0.25 / $1.50 per 1M tok", rank: 22 },
    // Catch-all for other free-tier Flash releases.
    { match: /flash/i, tier: "free tier", price: "free-tier friendly", rank: 4 },
  ],
  zai: [
    { match: /flash/i, tier: "fast tier", price: "near-free GLM route", rank: 0 },
    { match: /air/i, tier: "fast tier", price: "near-free GLM route", rank: 1 },
    { match: /glm-4\.7$/i, tier: "balanced", price: "best-value agentic GLM", rank: 2 },
    { match: /glm-4\.6$/i, tier: "balanced", price: "mid GLM cost tier", rank: 3 },
    { match: /glm-5\.1|glm-5$/i, tier: "flagship", price: "highest GLM quality tier", rank: 4 },
  ],
  qwen: [
    { match: /qwen3-turbo/i, tier: "fast tier", price: "lowest Qwen cost tier", rank: 0 },
    { match: /turbo/i, tier: "fast tier", price: "lowest Qwen cost tier", rank: 1 },
    { match: /qwen3-plus/i, tier: "balanced", price: "best-value Qwen workhorse", rank: 2 },
    { match: /plus/i, tier: "balanced", price: "mid Qwen cost tier", rank: 3 },
    { match: /qwen3-max/i, tier: "flagship", price: "highest Qwen quality tier", rank: 4 },
    { match: /max/i, tier: "flagship", price: "highest Qwen quality tier", rank: 5 },
  ],
  openai: [
    { match: /^gpt-5-nano$/i, tier: "efficient", price: "lowest OpenAI cost tier", rank: 0 },
    { match: /^gpt-5-mini$/i, tier: "balanced", price: "lower cost than flagship GPT-5", rank: 1 },
    { match: /^gpt-5$/i, tier: "premium", price: "flagship OpenAI tier", rank: 2 },
    { match: /^gpt-4\.1$/i, tier: "balanced+", price: "strong tool-calling value", rank: 3 },
    { match: /gpt-5-pro/i, tier: "ultra", price: "highest OpenAI quality tier", rank: 4 },
    // Legacy mini/o-series models last: superseded for tool calling.
    { match: /mini/i, tier: "efficient", price: "low OpenAI cost tier", rank: 5 },
    { match: /gpt-4o/i, tier: "legacy", price: "older generation", rank: 6 },
  ],
  claude: [
    { match: /claude-haiku-4-5|claude-[45]-haiku/i, tier: "efficient", price: "lowest Claude cost tier", rank: 0 },
    { match: /sonnet/i, tier: "balanced", price: "mid Claude cost tier — proven CAD sweet spot", rank: 1 },
    { match: /opus/i, tier: "ultra", price: "highest Claude quality tier", rank: 2 },
    { match: /haiku/i, tier: "efficient", price: "previous-generation Haiku", rank: 3 },
  ],
  openrouter: [
    // Free routes surface first, then value workhorses, then premium.
    { match: /:free$/i, tier: "free", price: "$0.00 on OpenRouter", rank: 0 },
    { match: /opus|gpt-5(?!-(mini|nano))|gemini-.*-pro|qwen3?-max|deepseek-r1/i, tier: "ultra", price: "premium tier", rank: 2 },
    { match: /sonnet|flash|mini|nano|haiku|air|small|chat|glm-[45]|kimi|plus|llama|turbo/i, tier: "value", price: "low-to-mid cost tier", rank: 1 },
  ],
  ollama: [
    // Everything local is free; order reflects the recommended CAD presets.
    { match: /qwen2\.5-coder:7b/i, tier: "local · free", price: "runs on your machine — fast default for CAD", rank: 0 },
    { match: /qwen2\.5-coder:14b/i, tier: "local · free", price: "runs on your machine — stronger geometry code", rank: 1 },
    { match: /qwen3-coder:30b/i, tier: "local · free", price: "runs on your machine — best local CAD quality (MoE, fast)", rank: 2 },
    { match: /qwen2\.5-coder/i, tier: "local · free", price: "runs on your machine — code-specialized", rank: 3 },
    { match: /qwen3-coder/i, tier: "local · free", price: "runs on your machine — agentic coding", rank: 3 },
    { match: /qwen3(?![-:]?[0-9])/i, tier: "local · free", price: "runs on your machine — general + tools", rank: 4 },
    { match: /gpt-oss/i, tier: "local · free", price: "runs on your machine — OpenAI open weights", rank: 4 },
    { match: /llama/i, tier: "local · free", price: "runs on your machine — general fallback", rank: 5 },
    { match: /vl|vision|llava|gemma|minicpm|moondream/i, tier: "local · free · vision", price: "runs on your machine — reads reference images", rank: 6 },
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
  zai: [
    {
      id: "zai-fast",
      label: "Z.AI Fast",
      cost: "lowest",
      priceNote: "Fastest, cheapest GLM route.",
      description: "Quick text-only CAD generation for simple parts and cheap retries.",
      preferredModels: ["glm-4.7-flash", "glm-4.5-air"],
    },
    {
      id: "zai-balanced",
      label: "Z.AI Balanced",
      cost: "low-medium",
      priceNote: "Stronger reasoning for measurements and repair loops.",
      description: "Everyday CAD preset with solid tool calling and constraint following.",
      preferredModels: ["glm-4.7", "glm-4.6"],
    },
    {
      id: "zai-ultra",
      label: "Ultra Z.AI",
      cost: "highest",
      priceNote: "Highest GLM quality/cost in the available catalog.",
      description: "Best GLM option for difficult prompts where quality beats raw thrift.",
      preferredModels: ["glm-5.1", "glm-5", "glm-4.7"],
    },
  ],
  qwen: [
    {
      id: "qwen-fast",
      label: "Qwen Fast",
      cost: "lowest",
      priceNote: "Lowest-cost DashScope preset.",
      description: "Very fast text-only CAD generation for simple parts and quick retries.",
      preferredModels: ["qwen3-turbo", "qwen-turbo"],
    },
    {
      id: "qwen-balanced",
      label: "Qwen Balanced",
      cost: "low-medium",
      priceNote: "Costs more than Fast, usually stronger reasoning.",
      description: "Balanced everyday CAD preset for measurements and build instructions.",
      preferredModels: ["qwen3-plus", "qwen-plus"],
    },
    {
      id: "qwen-ultra",
      label: "Ultra Qwen",
      cost: "highest",
      priceNote: "Uses Qwen's strongest flagship model.",
      description: "Best Qwen option for hard text-to-CAD prompts where quality wins.",
      preferredModels: ["qwen3-max", "qwen-max"],
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
      preferredModels: ["google/gemini-2.5-flash", "anthropic/claude-haiku-4.5", "openai/gpt-4.1-mini"],
    },
    {
      id: "or-performance",
      label: "OR Performance",
      cost: "medium",
      priceNote: "Balanced cost and capability.",
      description: "Strong CAD reasoning from flagship tier models.",
      preferredModels: ["anthropic/claude-sonnet-4.5", "meta-llama/llama-3.3-70b-instruct", "qwen/qwen3-max", "openai/gpt-4.1"],
    },
    {
      id: "or-ultra",
      label: "OR Ultra",
      cost: "highest",
      priceNote: "Premium models via OpenRouter.",
      description: "Complex logic and geometry.",
      preferredModels: ["google/gemini-2.5-pro", "anthropic/claude-opus-4.1"],
    },
  ],
  ollama: [
    {
      id: "ollama-fast",
      label: "Local Fast",
      cost: "free",
      priceNote: "Runs entirely on your machine — no API cost.",
      description: "Qwen2.5-Coder 7B: quick local CAD for simple parts, plates, holes, and brackets. Needs ~8 GB RAM.",
      preferredModels: ["qwen2.5-coder:7b", "qwen2.5-coder:latest"],
    },
    {
      id: "ollama-balanced",
      label: "Local Balanced",
      cost: "free",
      priceNote: "Runs entirely on your machine — no API cost.",
      description: "Qwen2.5-Coder 14B: noticeably better geometry code and fewer repair loops. Needs ~16 GB RAM.",
      preferredModels: ["qwen2.5-coder:14b", "qwen2.5-coder:7b"],
    },
    {
      id: "ollama-max",
      label: "Local Max",
      cost: "free",
      priceNote: "Runs entirely on your machine — no API cost.",
      description: "Qwen3-Coder 30B (MoE, 3.3B active): the best local CAD quality at near-8B speed. Needs ~24-32 GB RAM.",
      preferredModels: ["qwen3-coder:30b", "qwen2.5-coder:32b", "qwen2.5-coder:14b"],
    },
  ],
};

function modelInfo(providerId, modelId) {
  const table = MODEL_INFO[providerId] || [];
  for (const row of table) {
    if (row.match.test(modelId)) return row;
  }
  return { tier: "paid", price: "see provider pricing", rank: 90 };
}

const modelCache = new Map();

// Real per-token prompt prices captured from OpenRouter's catalog response.
// Used as the tiebreak inside equal ranks so cheaper models surface first
// and every free route lands above paid ones. Empty for other providers.
const openrouterPricing = new Map();

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
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const pa = openrouterPricing.get(a.id);
      const pb = openrouterPricing.get(b.id);
      const fa = Number.isFinite(pa) ? pa : Infinity;
      const fb = Number.isFinite(pb) ? pb : Infinity;
      if (fa !== fb) return fa - fb;
      return a.id.localeCompare(b.id);
    });
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

  // Z.AI and Qwen (DashScope) do not expose reliable public /models
  // endpoints, so ship curated catalogs of models that are verified to
  // support OpenAI-style tool calling — the one capability this agent
  // pipeline cannot work without.
  const CURATED = {
    zai: ["glm-4.7-flash", "glm-4.5-air", "glm-4.7", "glm-4.6", "glm-5.1", "glm-5"],
    qwen: ["qwen3-turbo", "qwen-turbo", "qwen3-plus", "qwen-plus", "qwen3-max", "qwen-max"],
  };

  let ids = [];
  // Auth/network failures are negatively cached: an invalid key would
  // otherwise re-hit the provider on every pipeline stage and every send,
  // adding latency and log noise without ever yielding a live catalog.
  const failureKey = `catalog-fail:${providerId}:${apiKey.slice(0, 16)}`;
  const failedAt = catalogFailures.get(failureKey);
  const catalogFetchable = !(failedAt && Date.now() - failedAt < CATALOG_FAILURE_TTL_MS);
  try {
    if (!catalogFetchable) {
      throw new Error("catalog fetch recently failed");
    } else if (CURATED[providerId]) {
      ids = CURATED[providerId];
    } else if (providerId === "gemini") {
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
    } else if (providerId === "openrouter") {
      // The catalog endpoint is public; ask for models that support tool
      // calling directly so every entry can actually drive the agent loop.
      const res = await fetch(`${provider.baseUrl}/models?supported_parameters=tools`, {
        headers: {
          "HTTP-Referer": "https://github.com/pulakit001/cadara-text-to-cad",
          "X-Title": "Cadara",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Only publishers with proven tool-calling quality make the cut —
      // the dropdown should show models that will actually build CAD.
      const TRUSTED = /^(openai|anthropic|google|meta-llama|qwen|mistralai|deepseek|x-ai|moonshotai|z-ai|microsoft)\//i;
      const rows = (data.data || [])
        .filter((m) => {
          const out = m.architecture?.output_modalities;
          if (Array.isArray(out) && !out.includes("text")) return false;
          const id = String(m.id || "");
          if (!TRUSTED.test(id)) return false;
          // Batch-only routes can't serve interactive agent turns.
          if (/(:batch|:offline)$/i.test(id)) return false;
          // Strip chat/embedding/rerank specials that would never build CAD.
          return !/embed|whisper|tts|guard|moderation|rerank|search|image-gen/i.test(id);
        });
      // Cheapest routes (including every free one) survive the cap; display
      // order is decided later by rank + real price inside annotate().
      rows.sort((a, b) => {
        const pa = Number(a.pricing?.prompt ?? NaN);
        const pb = Number(b.pricing?.prompt ?? NaN);
        const fa = Number.isFinite(pa) ? pa : Infinity;
        const fb = Number.isFinite(pb) ? pb : Infinity;
        return fa - fb;
      });
      openrouterPricing.clear();
      for (const m of rows.slice(0, 30)) {
        openrouterPricing.set(String(m.id), Number(m.pricing?.prompt ?? NaN));
      }
      ids = rows.slice(0, 30).map((m) => String(m.id));
    } else if (providerId === "ollama") {
      // Ollama's /v1/models lists exactly the models installed locally —
      // which is what the dropdown should show. Filter out Ollama's paid
      // "-cloud" routes and non-chat models.
      const res = await fetch(`${provider.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ids = (data.data || [])
        .map((m) => m.id)
        .filter((id) => !/(-cloud|embed|whisper|tts|guard|rerank|bge-|nomic|mxbai)/i.test(id));
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
          if (providerId === "openai") {
            return /gpt-4\.1|gpt-4o|gpt-5/i.test(id) && !/audio|realtime|image|tts|transcribe|embed/i.test(id);
          }
          return !/whisper|tts|guard|embed|distil-whisper|orpheus|safeguard/i.test(id);
        });
    }
  } catch {
    ids = [];
    if (failedAt === undefined || Date.now() - failedAt >= CATALOG_FAILURE_TTL_MS) {
      catalogFailures.set(failureKey, Date.now());
    }
  }

  const FALLBACK = {
    zai: CURATED.zai,
    qwen: CURATED.qwen,
    gemini: [
      // Order reflects what providers actually confirm works. When this
      // catalog is only used because the live fetch failed (e.g. an invalid
      // key), prefer ids known to still serve new requests.
      "gemini-3.6-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ],
    openai: ["gpt-5-nano", "gpt-5-mini", "gpt-5", "gpt-4.1", "gpt-5-pro", "gpt-4.1-mini"],
    claude: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"],
    openrouter: [
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-sonnet-4.5",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct",
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-pro",
    ],
    ollama: [
      "qwen2.5-coder:7b",
      "qwen2.5-coder:14b",
      "qwen3-coder:30b",
      "qwen3:8b",
      "gpt-oss:20b",
      "qwen3-vl:8b",
    ],
  };
  if (!ids.length) ids = FALLBACK[providerId] || [];

  const catalog = annotate(providerId, ids);
  modelCache.set(cacheKey, catalog);
  return catalog;
}

export class LLM {
  constructor({ provider: providerId, apiKey, model, timeoutMs = null, retryDelayScale = 1, rateLimitMaxAttempts = 5, rateLimitBudgetMs = 60000 } = {}) {
    const provider = providerById(providerId);
    if (!provider) throw new LLMConfigError(`Unknown provider: ${providerId}`);
    this.providerId = providerId;
    this.provider = provider;
    // Local runtimes (Ollama) don't use API keys — "ollama" is the
    // conventional ignored placeholder. Cloud providers require a real key.
    this.apiKey = apiKey || process.env[provider.keyEnv] || (provider.local ? "ollama" : "");
    this.model = model;
    // True when the caller pinned an exact model id; auto-selected models may
    // silently hop candidates on retirement errors, pinned ones may not.
    this.modelExplicit = Boolean(model);
    this._usedModels = new Set();
    if (model) this._usedModels.add(model);
    this._candidatePool = null;
    // Local models generate far slower than hosted APIs (a 7B on Apple
    // Silicon runs ~40-60 tok/s and the pipeline makes many calls), so the
    // per-request timeout is stretched hard for local providers.
    this.timeoutMs = timeoutMs ?? (provider.local ? 300000 : 75000);
    // retryDelayScale shrinks sleeps so tests run in milliseconds.
    this.retryDelayScale = retryDelayScale;
    this.rateLimitMaxAttempts = Math.max(1, rateLimitMaxAttempts);
    // Total seconds this client may spend sleeping out rate limits before
    // giving up (scaled by retryDelayScale so tests stay instant).
    this.rateLimitBudgetMs = Math.max(0, rateLimitBudgetMs);
    // Optional whole-run safety clock (epoch ms). Once passed, chat() throws
    // LLMDeadlineError instead of queueing another slow call.
    this.deadlineAt = null;
    // Optional AbortSignal from the owning job; aborting cancels in-flight
    // requests and backoff sleeps instantly.
    this.signal = null;
    if (!this.apiKey || /your-key-here/i.test(this.apiKey)) {
      throw new LLMConfigError(
        `${provider.label} API key is not set. Add ${provider.keyEnv} to .env or paste it in Settings.`
      );
    }
  }

  setCancelSignal(signal) {
    this.signal = signal;
    return this;
  }

  setDeadline(at) {
    this.deadlineAt = at;
    return this;
  }

  // Per-call telemetry sink. main.js installs globalThis.__cadaraLlmTelemetry
  // to persist entries into userData/cadara-agent.log. Outside Electron,
  // setting CADARA_AGENT_LOG=<path> captures the same JSONL stream; when
  // neither is present this is a no-op (tests stay quiet).
  _telemetry(entry) {
    if (typeof globalThis.__cadaraLlmTelemetry === "function") {
      try {
        globalThis.__cadaraLlmTelemetry(entry);
      } catch { }
      return;
    }
    const logPath = process.env.CADARA_AGENT_LOG;
    if (!logPath) return;
    try {
      fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
    } catch { }
  }

  async chat({ messages, tools = null, temperature = 0.4, onRetry = null }) {
    const hasImage = messagesContainImage(messages);
    if (!this.model) {
      const fullCatalog = await listModels(this.providerId, this.apiKey);
      const catalog = hasImage ? fullCatalog.filter((m) => m.supportsVision) : fullCatalog;
      if (!catalog.length) throw new LLMConfigError("No models available for this provider.");
      // Skip routes whose process-wide breaker is open from earlier failures.
      const usable = catalog.filter((m) => !routeIsBroken(this.providerId, m.id));
      this.model = (usable[0] || catalog[0]).id;
      // Remember the ranked rest as auto-switch candidates: if the provider
      // retires/fails the first pick mid-run we advance down this list
      // instead of dying (or pointlessly re-sending the same doomed call).
      this._candidatePool = catalog.map((m) => m.id);
    }
    if (hasImage && !modelSupportsVision(this.providerId, this.model)) {
      throw new LLMConfigError(`${this.model} does not support image input. Pick a vision-capable model or remove the reference image.`);
    }

    const body = { messages, temperature, model: this.model };
    if (tools && tools.length) body.tools = tools;
    if (/gpt-oss/i.test(this.model)) {
      body.reasoning_effort = "low";
      body.max_tokens = 4096;
    }
    // DashScope rejects non-streaming calls to Qwen3 thinking-capable
    // models unless thinking is explicitly disabled.
    if (this.providerId === "qwen") {
      body.enable_thinking = false;
    }
    // Always send an explicit completion budget. When omitted, several
    // OpenAI-compatible gateways assume the MODEL MAX (e.g. 65,535 for
    // gemini-2.5-flash) and reject the whole call on credit preflight
    // ("requested up to 65535 tokens…"), even though generated CAD sources
    // need only a few thousand tokens.
    if (!body.max_tokens) {
      const configured = Number.parseInt(process.env.CADARA_MAX_TOKENS || "", 10);
      body.max_tokens = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 32000) : 8192;
    }

    let attempt = 1;
    let timeouts = 0;
    let modelSwitches = 0;
    let rlStreak = 0; // consecutive rate-limit failures without any success
    const maxAttempts = 3;
    let rateLimitAttempts = 0;
    let rateLimitWaitTotal = 0;
    const rateLimitBudget = this.rateLimitBudgetMs * this.retryDelayScale;

    while (attempt <= maxAttempts) {
      // Whole-run safety clock: no new call may start past the deadline, and
      // an in-flight call is cut short at the deadline instead of riding its
      // full timeout.
      if (this.deadlineAt && Date.now() >= this.deadlineAt) {
        throw new LLMDeadlineError();
      }
      const callTimeout = this.deadlineAt
        ? Math.min(this.timeoutMs, Math.max(5000, this.deadlineAt - Date.now()))
        : this.timeoutMs;
      try {
        const callStartedAt = Date.now();
        const message = await this.requestChat(body, callTimeout);
        rlStreak = 0;
        routeFailStreak.delete(`${this.providerId}|${body.model}`);
        this._telemetry({
          event: "llm_call",
          provider: this.providerId,
          model: body.model,
          durationMs: Date.now() - callStartedAt,
          status: "ok",
          usage: message.__usage || null,
        });
        return message;
      } catch (err) {
        this._telemetry({
          event: "llm_call",
          provider: this.providerId,
          model: body.model,
          status: err.name,
          error: String(err?.message || "").slice(0, 300),
          retryAfterMs: err.retryAfterMs ?? null,
          quotaScope: err.quotaScope ?? null,
        });
        if (err.name === "JobCanceledError") throw err;
        if (err.name === "LLMDeadlineError") throw err;

        // Retired/unavailable models must never burn retries against the
        // same dead id. Advance to the next ranked candidate (or the exact
        // replacement the provider suggested), bounded so a fully broken
        // catalog fails fast with an actionable message.
        if (err.name === "LLMModelError") {
          this._usedModels.add(body.model);
          modelSwitches++;
          const suggestion =
            err.suggestedModel && !this._usedModels.has(err.suggestedModel)
              ? err.suggestedModel
              : null;
          let nextModel = null;
          if (suggestion) {
            // A server-provided replacement is trustworthy even when the
            // caller pinned a model — it is that exact model's successor.
            nextModel = suggestion;
          } else if (!this.modelExplicit && this._candidatePool) {
            nextModel = this._candidatePool.find((id) => !this._usedModels.has(id)) || null;
          }
          if (nextModel && modelSwitches <= 6) {
            body.model = nextModel;
            this.model = nextModel;
            continue;
          }
          const tried = [...this._usedModels];
          throw new LLMConfigError(
            `${this.provider.label}: no usable model (tried ${tried.join(", ")}). Last error: ${err.message}` +
            (this.modelExplicit ? " Pick a different model in AI Config." : ""),
            { fallbackable: true }
          );
        }

        // Rate limits get their own track: more attempts and exponential
        // backoff (respecting Retry-After) so a free-tier quota window can
        // pass without the pipeline dying and restarting from zero.
        if (err instanceof LLMRateLimitError) {
          rlStreak++;
          // Process-wide breaker for routes that keep answering with instant,
          // unexplained 429s (free/shared pools). Persists across chat() calls,
          // stages, and fresh LLM instances — a per-call counter resets every
          // phase and doom-loops instead. Once open, the error is marked
          // unwaitable so client ladders AND step-level retries skip it.
          const bare = !err.retryAfterMs && !err.quotaScope;
          if (bare) {
            const { key } = routeFailRecord(this.providerId, body.model);
            const rec = routeFailStreak.get(key) || { count: 0, updatedAt: 0 };
            rec.count += 1;
            rec.updatedAt = Date.now();
            routeFailStreak.set(key, rec);
            if (rec.count >= RATE_LIMIT_STREAK_ESCALATE) {
              err.unwaitable = true;
              err.quotaReason = err.quotaReason || `${rec.count} consecutive rate-limited responses`;
            }
          }
          // Escalate instead of waiting when the window can't pass inside
          // this run, or when this model has become known-bad: advancing to
          // another ranked candidate often works immediately; otherwise
          // surface now rather than after minutes of doomed sleeps.
          if (err.unwaitable) {
            this._usedModels.add(body.model);
            const nextCandidate =
              !this.modelExplicit && modelSwitches < 6 && this._candidatePool
                ? this._candidatePool.find((id) => !this._usedModels.has(id))
                : null;
            if (nextCandidate) {
              body.model = nextCandidate;
              this.model = nextCandidate;
              modelSwitches++;
              rlStreak = 0;
              continue;
            }
            throw err;
          }
          rateLimitAttempts++;
          let delayMs = rateLimitBackoffMs(rateLimitAttempts, err.retryAfterMs, this.retryDelayScale);
          // Real runs spread retries apart so parallel pipeline stages don't
          // re-hammer the provider at the same instant. Tests (tiny scale)
          // stay exact.
          if (this.retryDelayScale >= 1) {
            delayMs = Math.round(delayMs * (0.9 + Math.random() * 0.2));
          }
          // Attempt budget AND total-wait budget both apply: a provider that
          // keeps limiting us hands the job to the next provider quickly
          // instead of stalling the pipeline for many minutes.
          if (rateLimitAttempts >= this.rateLimitMaxAttempts || rateLimitWaitTotal + delayMs > rateLimitBudget) throw err;
          rateLimitWaitTotal += delayMs;
          if (onRetry) {
            onRetry({ attempt: rateLimitAttempts, maxAttempts: this.rateLimitMaxAttempts - 1, delayMs, retryAfterMs: err.retryAfterMs });
          }
          await abortableSleep(delayMs, this.signal);
          continue;
        }
        const retryable =
          err.name === "LLMTransientError" ||
          err.name === "LLMServerError" ||
          err.name === "LLMTimeoutError";
        if (!retryable || attempt === maxAttempts) throw err;
        if (err.name === "LLMTimeoutError" && ++timeouts >= 3) throw err;

        await abortableSleep(attempt * 2000 * this.retryDelayScale, this.signal);
        attempt++;
      }
    }
  }

  async requestChat(body, timeoutMs = null) {
    if (this.providerId === "claude") return this.requestClaudeChat(body, timeoutMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    const onJobCanceled = () => controller.abort();
    if (this.signal) {
      if (this.signal.aborted) {
        clearTimeout(timer);
        throw canceledError();
      }
      this.signal.addEventListener("abort", onJobCanceled);
    }

    let res;
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      };
      // Recommended OpenRouter attribution headers (optional but they make
      // the app visible in OpenRouter's rankings dashboard).
      if (this.providerId === "openrouter") {
        headers["HTTP-Referer"] = "https://github.com/pulakit001/cadara-text-to-cad";
        headers["X-Title"] = "Cadara";
      }
      res = await fetch(`${this.provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      this.signal?.removeEventListener("abort", onJobCanceled);
      if (this.signal?.aborted || err.name === "JobCanceledError") throw canceledError();
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
    this.signal?.removeEventListener("abort", onJobCanceled);

    const rawText = await res.text().catch(() => "");
    let data = {};
    try {
      data = JSON.parse(rawText);
    } catch { }
    const errType = data?.error?.type || "";
    const errMsg = data?.error?.message || "";

    if (res.status === 401 || res.status === 403) {
      if (/model.*(not support|not found|does not exist)|unsupported model/i.test(errMsg)) {
        throw new LLMModelError(body.model, this.provider.label);
      }
      // Google answers credentials that are not Generative Language API keys
      // (e.g. AQ.-prefixed OAuth/Vertex tokens) with UNAUTHENTICATED plus
      // "Expected OAuth 2 access token…" — explain the exact remedy instead
      // of a generic key error.
      const wrongCredentialKind = /OAuth 2|API_KEY_SERVICE_BLOCKED|UNAUTHENTICATED/i.test(errType + errMsg);
      const hint =
        this.providerId === "gemini" && wrongCredentialKind
          ? ' Gemini keys must be AI Studio API keys starting with "AIza"; "AQ."-prefixed keys are OAuth/Vertex credentials and are rejected here. Create one at https://aistudio.google.com/apikey.'
          : "";
      throw new LLMConfigError(`Invalid ${this.provider.label} API key. Update it in Settings.${hint}`, { fallbackable: true });
    }
    if (res.status === 404 || /no longer available|is not found|does not exist/i.test(String(errMsg))) {
      const modelErr = new LLMModelError(body.model, this.provider.label);
      // Providers often name the exact successor ("…use models/gemini-3.6-flash");
      // carry it so chat() can hop straight to the recommended id.
      const match = String(errMsg).match(/use models\/([A-Za-z0-9._\-:/]+)/i);
      if (match) modelErr.suggestedModel = match[1];
      if (/no longer available/i.test(String(errMsg))) modelErr.retired = true;
      throw modelErr;
    }
    if (res.status === 429) {
      // Parse structured quota scope from the body (Google RetryInfo /
      // QuotaFailure violations, OpenRouter daily-cap phrasing, …) so waiting
      // only happens for windows that can actually pass within a run.
      const info = describeRateLimitBody(res.status, rawText);
      const headerRetry = parseRetryAfterMs(res.headers.get("retry-after"));
      const retryMs = headerRetry ?? info.retryAfterMs;
      let scope = info.quotaScope;
      if (!scope && retryMs != null && retryMs > RATE_LIMIT_WAITABLE_CEILING_MS) scope = "long";
      throw new LLMRateLimitError(undefined, retryMs, {
        quotaScope: scope,
        quotaReason: info.quotaReason,
        providerDetail: info.detail,
      });
    }
    if (res.status >= 500) {
      const serverErr = new Error(`${this.provider.label} server error (HTTP ${res.status}). Retrying...`);
      serverErr.name = "LLMServerError";
      throw serverErr;
    }

    // Credit preflight rejections (OpenRouter et al.) arrive as HTTP 400/402
    // and must NOT be retried against the same route: no amount of waiting
    // fixes an empty wallet. Surface them as account-scoped quota errors so
    // provider fallback can hop to a healthier key immediately.
    if (
      (res.status === 400 || res.status === 402) &&
      /requires more credits|can only afford|insufficient credits/i.test(String(errMsg))
    ) {
      const info = describeRateLimitBody(res.status, rawText);
      throw new LLMRateLimitError(String(errMsg), null, {
        quotaScope: info.quotaScope || "account",
        providerDetail: info.detail,
      });
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
    // Some providers expose reasoning as message.reasoning on thinking models.
    if (!message.reasoning_content && typeof message.reasoning === "string") {
      message.reasoning_content = message.reasoning;
    }
    message.__usage = data.usage || null;
    return message;
  }

  async requestClaudeChat(body, timeoutMs = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    const onJobCanceled = () => controller.abort();
    if (this.signal) {
      if (this.signal.aborted) {
        clearTimeout(timer);
        throw canceledError();
      }
      this.signal.addEventListener("abort", onJobCanceled);
    }

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
      this.signal?.removeEventListener("abort", onJobCanceled);
      if (this.signal?.aborted || err.name === "JobCanceledError") throw canceledError();
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
    this.signal?.removeEventListener("abort", onJobCanceled);

    const data = await res.json().catch(() => ({}));
    const errType = data?.error?.type || "";
    const errMsg = data?.error?.message || "";

    if (res.status === 401 || res.status === 403) {
      throw new LLMConfigError(`Invalid ${this.provider.label} API key. Update it in Settings.`);
    }
    if (res.status === 404) throw new LLMModelError(body.model, this.provider.label);
    if (res.status === 429) throw new LLMRateLimitError(undefined, parseRetryAfterMs(res.headers.get("retry-after")));
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
