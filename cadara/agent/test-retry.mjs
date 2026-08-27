/**
 * @file test-retry.mjs
 * @description Unit tests for the rate-limit recovery stack:
 * backoff math (llm.mjs), client-level 429 retry (LLM.chat), and
 * step-level resume (withRateLimitRetry in agent.mjs).
 *
 * Run: node agent/test-retry.mjs
 */

import assert from "node:assert/strict";
import { LLM, LLMConfigError, LLMModelError, LLMRateLimitError, canceledError, parseRetryAfterMs, rateLimitBackoffMs, describeRateLimitBody, routeIsBroken } from "./llm.mjs";
import { withRateLimitRetry } from "./agent.mjs";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeLLM(overrides = {}) {
  const llm = new LLM({ provider: "openai", apiKey: "test-key", model: "test-model", retryDelayScale: 0.001, ...overrides });
  return llm;
}

console.log("parseRetryAfterMs / rateLimitBackoffMs");

await test("parses seconds-form Retry-After", () => {
  assert.equal(parseRetryAfterMs("30"), 30000);
  assert.equal(parseRetryAfterMs("0"), 0);
});

await test("rejects non-numeric junk", () => {
  assert.equal(parseRetryAfterMs("soon"), null);
  assert.equal(parseRetryAfterMs(null), null);
});

await test("exponential backoff grows and caps at 30s", () => {
  assert.equal(rateLimitBackoffMs(1), 1000);
  assert.equal(rateLimitBackoffMs(2), 2000);
  assert.equal(rateLimitBackoffMs(3), 4000);
  assert.equal(rateLimitBackoffMs(5), 16000);
  assert.equal(rateLimitBackoffMs(6), 30000);
  assert.equal(rateLimitBackoffMs(7), 30000);
  assert.equal(rateLimitBackoffMs(9), 30000);
});

await test("server Retry-After overrides backoff, capped at 30s", () => {
  assert.equal(rateLimitBackoffMs(1, 8000), 8000);
  assert.equal(rateLimitBackoffMs(1, 25000), 25000);
  assert.equal(rateLimitBackoffMs(1, 999999), 30000);
});

await test("total rate-limit wait budget bounds a run", async () => {
  // Default attempt cap (5) bounds a stubborn provider even when every
  // window is honored. Bare-429 storms escalate to another model instead
  // (dedicated tests below); here we honor a Retry-After-shaped window.
  const llm = makeLLM();
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw new LLMRateLimitError(undefined, 2); // tiny waitable window
  };
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), LLMRateLimitError);
  assert.ok(calls >= 3 && calls <= 8, `bounded by attempts+budget (got ${calls})`);
});

await test("scale shrinks delays for tests", () => {
  assert.equal(rateLimitBackoffMs(2, null, 0.001), 2);
});

console.log("LLM.chat client-level retry");

await test("429s are retried with backoff until the call succeeds", async () => {
  const llm = makeLLM();
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    if (calls < 3) throw new LLMRateLimitError();
    return { role: "assistant", content: "recovered" };
  };
  const retries = [];
  const message = await llm.chat({
    messages: [{ role: "user", content: "hi" }],
    onRetry: (info) => retries.push(info),
  });
  assert.equal(message.content, "recovered");
  assert.equal(calls, 3);
  assert.equal(retries.length, 2);
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[1].delayMs, 2); // 2^1 * 1000ms * 0.001 scale
});

await test("Retry-After from the server is honored on retry delays", async () => {
  const llm = makeLLM();
  llm.requestChat = async () => {
    if (llm.__rl === undefined) llm.__rl = 0;
    llm.__rl++;
    if (llm.__rl === 1) throw new LLMRateLimitError(undefined, 25000);
    return { role: "assistant", content: "ok" };
  };
  const retries = [];
  await llm.chat({ messages: [{ role: "user", content: "hi" }], onRetry: (i) => retries.push(i) });
  assert.equal(retries[0].retryAfterMs, 25000);
});

await test("gives up after the configured attempt budget", async () => {
  const llm = makeLLM({ rateLimitMaxAttempts: 3 });
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw new LLMRateLimitError();
  };
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), LLMRateLimitError);
  assert.equal(calls, 3);
});

await test("non-retryable config errors are never retried", async () => {
  const llm = makeLLM();
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw new LLMConfigError("bad key");
  };
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), LLMConfigError);
  assert.equal(calls, 1);
});

console.log("withRateLimitRetry step-level resume");

function collector() {
  const events = [];
  return { events, onEvent: (type, payload) => events.push({ type, payload }) };
}

await test("re-runs the failed step from its start and keeps earlier results", async () => {
  const { events, onEvent } = collector();
  let runs = 0;
  const outsideSteps = ["planner-output"];
  const result = await withRateLimitRetry({
    onEvent,
    agentId: "planner",
    agentName: "Planner",
    step: 4,
    phase: "planning",
    retryDelayMs: () => 1,
    run: async () => {
      runs++;
      if (runs < 3) throw new LLMRateLimitError();
      return { plan: "ok", inputs: outsideSteps };
    },
  });
  assert.equal(result.plan, "ok");
  assert.equal(runs, 3); // step re-ran from its start; caller state untouched
  const retryEvents = events.filter((e) => e.type === "agent" && /Rate limited/.test(e.payload.detail || ""));
  assert.equal(retryEvents.length, 2);
  assert.equal(retryEvents[0].payload.status, "running"); // never shown as a dead stop
});

await test("non-rate-limit failures propagate immediately", async () => {
  const { onEvent } = collector();
  let runs = 0;
  await assert.rejects(
    () =>
      withRateLimitRetry({
        onEvent,
        agentId: "builder",
        agentName: "Builder",
        step: 5,
        phase: "building",
        retryDelayMs: () => 1,
        run: async () => {
          runs++;
          throw new Error("python crashed");
        },
      }),
    /python crashed/
  );
  assert.equal(runs, 1);
});

await test("exhausts step retries, then throws a rate-limit error with guidance", async () => {
  const { onEvent } = collector();
  let runs = 0;
  await assert.rejects(
    () =>
      withRateLimitRetry({
        onEvent,
        agentId: "spec",
        agentName: "Intake / Spec",
        step: 3,
        phase: "spec",
        retryDelayMs: () => 1,
        run: async () => {
          runs++;
          throw new LLMRateLimitError();
        },
      }),
    (err) => err instanceof LLMRateLimitError && /switch model\/provider/i.test(err.message)
  );
  assert.equal(runs, 4); // initial attempt + 3 step retries
});

console.log("cancellation");

await test("aborting the job signal cuts a backoff sleep short instantly", async () => {
  const llm = makeLLM({ retryDelayScale: 1 }); // real-scale delay so only one call fits before abort
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw new LLMRateLimitError(undefined, 10000); // 10s wait
  };
  const controller = new AbortController();
  llm.setCancelSignal(controller.signal);
  setTimeout(() => controller.abort(), 50);
  const startedAt = Date.now();
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), (err) => err.name === "JobCanceledError");
  assert.ok(Date.now() - startedAt < 2000, "cancel must not wait out the backoff");
  assert.equal(calls, 1);
});

await test("cancellation is never retried as if it were a rate limit", async () => {
  const llm = makeLLM();
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw canceledError();
  };
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), (err) => err.name === "JobCanceledError");
  assert.equal(calls, 1);
});

await test("step retry aborts instantly when the job is canceled mid-wait", async () => {
  const controller = new AbortController();
  let runs = 0;
  setTimeout(() => controller.abort(), 50);
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      withRateLimitRetry({
        onEvent: () => {},
        agentId: "planner",
        agentName: "Planner",
        step: 4,
        phase: "planning",
        retryDelayMs: () => 10000,
        signal: controller.signal,
        run: async () => {
          runs++;
          throw new LLMRateLimitError();
        },
      }),
    (err) => err.name === "JobCanceledError"
  );
  assert.ok(Date.now() - startedAt < 2000, "step retry must wake on cancel");
  assert.equal(runs, 1);
});

console.log("quota-scope parsing / unwaitable escalation");

await test("Google QuotaFailure PerDay body is classified as a daily cap", () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      message: "Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel",
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/GenerateRequestsPerDayPerProjectPerModel" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3276s" },
      ],
    },
  });
  const info = describeRateLimitBody(429, body);
  assert.equal(info.quotaScope, "day");
  assert.equal(info.retryAfterMs, 3276000);
});

await test("OpenRouter daily-cap phrasing is classified without structured details", () => {
  const info = describeRateLimitBody(429, JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day (50 requests per day). Try again later." } }));
  assert.equal(info.quotaScope, "day");
});

await test("credit-preflight rejections classify as account-scope (never waitable)", () => {
  const info = describeRateLimitBody(400, JSON.stringify({
    error: { message: "This request requires more credits, or fewer max_tokens. You requested up to 65535 tokens, but can only afford 15096." },
  }));
  assert.equal(info.quotaScope, "account");
});

await test("a long Retry-Only header still marks the limit unwaitable", async () => {
  const llm = makeLLM({ retryDelayScale: 0.001 });
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw new LLMRateLimitError(undefined, 3600000); // 1 hour
  };
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), LLMRateLimitError);
  assert.equal(calls, 1, "unwaitable limits must not be retried at client level");
});

console.log("LLMModelError handling");

await test("retired model errors auto-switch to catalog candidates instead of dying", async () => {
  const llm = makeLLM();
  llm.modelExplicit = false;
  llm.model = "gemini-2.5-flash"; // auto-pick landed on a retired id
  llm._usedModels = new Set(["gemini-2.5-flash"]);
  llm._candidatePool = ["gemini-3.6-flash", "gemini-2.5-pro"];
  const seenModels = [];
  llm.requestChat = async (body) => {
    seenModels.push(body.model);
    if (body.model === "gemini-2.5-flash") {
      const err = new LLMModelError(body.model, "Gemini");
      err.suggestedModel = "gemini-3.6-flash";
      throw err;
    }
    return { role: "assistant", content: "ok from " + body.model };
  };
  const out = await llm.chat({
    messages: [{ role: "user", content: "hi" }],
  });
  assert.match(out.content, /gemini-3\.6-flash/, "must land on the provider-recommended successor");
  assert.deepEqual(seenModels[0], "gemini-2.5-flash");
});

await test("a fully dead catalog fails fast as a fallbackable config error", async () => {
  const llm = makeLLM();
  llm.modelExplicit = false;
  llm.model = "a";
  llm._usedModels = new Set(["a"]);
  llm._candidatePool = ["b"];
  let calls = 0;
  llm.requestChat = async (body) => {
    calls++;
    throw new LLMModelError(body.model, "Test");
  };
  await assert.rejects(
    () => llm.chat({ messages: [{ role: "user", content: "hi" }] }),
    (err) => err instanceof LLMConfigError && err.fallbackable === true
  );
  assert.ok(calls <= 4, `bounded switching (got ${calls} calls)`);
});

await test("pinned models surface model errors immediately without retries", async () => {
  const llm = makeLLM();
  llm.modelExplicit = true;
  let calls = 0;
  llm.requestChat = async () => {
    calls++;
    throw new LLMModelError("pinned-model", "Test");
  };
  await assert.rejects(
    () => llm.chat({ messages: [{ role: "user", content: "hi" }] }),
    LLMConfigError
  );
  assert.equal(calls, 1);
});

console.log("rate-limit model escalation");

await test("instant unexplained 429s on one model escalate to the next catalog candidate", async () => {
  const llm = makeLLM({ retryDelayScale: 0.001 });
  llm.modelExplicit = false;
  llm.model = "shared/route-a:free";
  llm._usedModels = new Set(["shared/route-a:free"]);
  llm._candidatePool = ["deepseek/deepseek-v4-flash", "z-ai/glm-5.2:free"];
  const seenModels = [];
  llm.requestChat = async (body) => {
    seenModels.push(body.model);
    if (/:free$/.test(body.model)) throw new LLMRateLimitError();
    return { role: "assistant", content: "ok from " + body.model };
  };
  const out = await llm.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.content, "ok from deepseek/deepseek-v4-flash");
  assert.ok(seenModels.length <= 6, "escalation must be quick (no ladder storm)");
});

await test("when every candidate is rate-limited it fails fast instead of waiting minutes", async () => {
  const llm = makeLLM({ retryDelayScale: 0.001 });
  llm.modelExplicit = false;
  llm.model = "a";
  llm._usedModels = new Set(["a"]);
  llm._candidatePool = ["b"];
  let calls = 0;
  const t0 = Date.now();
  llm.requestChat = async () => {
    calls++;
    throw new LLMRateLimitError();
  };
  await assert.rejects(() => llm.chat({ messages: [{ role: "user", content: "hi" }] }), LLMRateLimitError);
  assert.ok(Date.now() - t0 < 5000, "must not sit through long backoffs when nothing can serve");
});

await test("the bare-429 breaker persists ACROSS chat() calls and phases", async () => {
  const llm = makeLLM({ retryDelayScale: 0.001, model: "breaker-probe-route" }); // pinned free-route model
  let calls = 0;
  const retries = [];
  llm.requestChat = async () => {
    calls++;
    throw new LLMRateLimitError(); // instant, no Retry-After, no scope
  };
  // Phase 1: opens the breaker on the third consecutive failure.
  await assert.rejects(
    () =>
      llm.chat({
        messages: [{ role: "user", content: "hi" }],
        onRetry: (info) => retries.push(info),
      }),
    (err) => err.unwaitable === true
  );
  // Phase 2 (a separate chat() call, like the pipeline's next stage): must
  // fail INSTANTLY with zero additional client backoff.
  const t0 = Date.now();
  await assert.rejects(
    () => llm.chat({ messages: [{ role: "user", content: "hi" }] }),
    (err) => err.unwaitable === true
  );
  assert.ok(Date.now() - t0 < 300, "breaker-open routes must fail immediately");
  assert.equal(retries.length, 2, "only the two initial waits ever happened");
  assert.ok(calls <= 5, `total network hits stay minimal (${calls})`);
  assert.equal(routeIsBroken("openai", "breaker-probe-route"), true);
});

console.log("step-level unwaitable escalation");

await test("daily-quota errors skip step retries and propagate instantly", async () => {
  const { onEvent } = collector();
  let runs = 0;
  await assert.rejects(
    () =>
      withRateLimitRetry({
        onEvent,
        agentId: "builder",
        agentName: "Builder",
        step: 5,
        phase: "building",
        run: async () => {
          runs++;
          throw new LLMRateLimitError("day over", null, { quotaScope: "day" });
        },
      }),
    (err) => err.unwaitable === true
  );
  assert.equal(runs, 1, "no pointless re-runs against an exhausted daily pool");
});

console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);
