/**
 * @file test-retry.mjs
 * @description Unit tests for the rate-limit recovery stack:
 * backoff math (llm.mjs), client-level 429 retry (LLM.chat), and
 * step-level resume (withRateLimitRetry in agent.mjs).
 *
 * Run: node agent/test-retry.mjs
 */

import assert from "node:assert/strict";
import { LLM, LLMConfigError, LLMRateLimitError, parseRetryAfterMs, rateLimitBackoffMs } from "./llm.mjs";
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
  const llm = new LLM({ provider: "groq", apiKey: "test-key", model: "test-model", retryDelayScale: 0.001, ...overrides });
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

await test("exponential backoff grows and caps at 60s", () => {
  assert.equal(rateLimitBackoffMs(1), 2000);
  assert.equal(rateLimitBackoffMs(2), 4000);
  assert.equal(rateLimitBackoffMs(3), 8000);
  assert.equal(rateLimitBackoffMs(6), 60000);
  assert.equal(rateLimitBackoffMs(9), 60000);
});

await test("server Retry-After overrides backoff, capped at 60s", () => {
  assert.equal(rateLimitBackoffMs(1, 45000), 45000);
  assert.equal(rateLimitBackoffMs(1, 999999), 60000);
});

await test("scale shrinks delays for tests", () => {
  assert.equal(rateLimitBackoffMs(2, null, 0.001), 4);
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
  assert.equal(retries[1].delayMs, 4); // 2^2 * 0.001 scale
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

console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);
