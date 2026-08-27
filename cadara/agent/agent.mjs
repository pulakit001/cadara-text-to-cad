/**
 * @file agent.mjs
 * @description The core CAD generation pipeline and agent orchestration.
 * Handles the multi-step LLM process (Routing, Spec, Planning, Building, Reviewing),
 * parses LLM outputs, executes Python scripts, and handles recovery/iteration loops.
 * 
 * @module CadaraAgent
 */

import path from "node:path";
import { LLM, LLMConfigError, LLMDeadlineError, LLMRateLimitError, canceledError, modelSupportsVision } from "./llm.mjs";
import { TOOLS, generatePart } from "./tools.mjs";
import { plannerPrompt, reviewerPrompt, routerPrompt, specPrompt, systemPrompt } from "./prompts.mjs";
import { compactDesignContext } from "./session.mjs";

const MAX_ITERATIONS = 8;

// Phase-level rate-limit recovery. By the time an LLMRateLimitError escapes
// llm.chat() the client-level exponential backoff is exhausted, so we re-run
// the whole phase (planner, builder turn, ...) from its start — prior phases
// keep their results — with a few extra spaced attempts before giving up.
const RATE_LIMIT_STEP_RETRIES = 3;
const RATE_LIMIT_STEP_RETRY_DELAY_MS = 1500;

// Sleep that wakes instantly on job cancel.
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

export async function withRateLimitRetry({ onEvent, agentId, agentName, step, phase, run, retryDelayMs = null, signal = null }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (err.name === "JobCanceledError" || signal?.aborted) throw canceledError();
      if (!(err instanceof LLMRateLimitError)) throw err;
      // Daily/account quota exhaustion cannot recover by waiting here —
      // surface it immediately so provider fallback can route around it.
      if (err.unwaitable || attempt >= RATE_LIMIT_STEP_RETRIES) {
        if (!err.unwaitable) {
          err.message =
            `${agentName} is still rate-limited after ${RATE_LIMIT_STEP_RETRIES} retries. ` +
            "Wait a minute and send the request again, or switch model/provider in AI Config.";
        }
        throw err;
      }
      const delay = typeof retryDelayMs === "function"
        ? retryDelayMs(attempt)
        : (retryDelayMs ?? RATE_LIMIT_STEP_RETRY_DELAY_MS * (attempt + 1));
      const delayMs = delay;
      emitAgent(onEvent, agentId, agentName, "running",
        `Rate limited — retrying this step in ${Math.round(delayMs / 1000)}s (retry ${attempt + 1}/${RATE_LIMIT_STEP_RETRIES})`,
        { step, totalSteps: 6, phase });
      onEvent("status", `${agentName}: rate limited — retrying step (attempt ${attempt + 1} of ${RATE_LIMIT_STEP_RETRIES}) ...`);
      await abortableSleep(delayMs, signal);
    }
  }
}

// Passes rate limits through so withRateLimitRetry can resume the step;
// any other failure degrades to the fallback the caller already has.
function swallowNonRateLimit(err) {
  if (err instanceof LLMRateLimitError) throw err;
  return null;
}

// Surfaces client-level backoff waits as "running" progress so the pipeline
// UI shows a live countdown instead of looking stalled.
function onLlmRetry(onEvent, agentId, agentName, step, phase) {
  return (info) => {
    emitAgent(onEvent, agentId, agentName, "running",
      `Rate limited — waiting ${Math.max(1, Math.round(info.delayMs / 1000))}s (try ${info.attempt} of ${info.maxAttempts})`,
      { step, totalSteps: 6, phase });
  };
}

/**
 * Normalizes a text prompt into a short slug (for filenames and identifiers).
 * @param {string} prompt - The raw user prompt.
 * @returns {string} The slugified prompt string (max 4 words).
 */
function slugFromPrompt(prompt) {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 4)
    .join("-");
  return words || "part";
}

/**
 * Extracts python code from a markdown fenced code block.
 * @param {string} text - The raw LLM response.
 * @returns {string} The extracted python code.
 */
function extractFencedCode(text) {
  const m = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  return m ? m[1].trim() : "";
}

/**
 * Normalizes errors into standard JavaScript Error objects.
 * Passes through custom LLMConfigError and LLMRateLimitError unchanged.
 * @param {Error|string} err - The caught error.
 * @returns {Error} The normalized error object.
 */
function normalizeError(err) {
  if (err instanceof LLMConfigError || err instanceof LLMRateLimitError) return err;
  return new Error(String(err.message || err));
}

const PIPELINE_PHASES = ["routing", "reference", "spec", "planning", "building", "reviewing"];
const PIPELINE_LABELS = {
  routing: "Router",
  reference: "Reference",
  spec: "Intake / Spec",
  planning: "Planner",
  building: "Builder",
  reviewing: "Reviewer",
};

function emitAgent(onEvent, id, name, status, detail = "", extra = {}) {
  onEvent("agent", { id, name, status, detail, startedAt: Date.now(), ...extra });
}

function emitPipeline(onEvent, phase, stepIndex) {
  onEvent("pipeline", {
    phase,
    stepIndex,
    totalSteps: PIPELINE_PHASES.length,
    phases: PIPELINE_PHASES,
    labels: PIPELINE_LABELS,
    progress: Math.round(((stepIndex - 1) / PIPELINE_PHASES.length) * 100),
  });
}

function parseJsonObject(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function extractTraceback(stderr) {
  if (!stderr) return "";
  const tbMatch = stderr.match(/Traceback \(most recent call last\):[\s\S]*$/m);
  return tbMatch ? tbMatch[0].slice(-2000) : stderr.slice(-1500);
}

// Compares previous vs rebuilt geometry so a modify run that silently
// redesigned the part is surfaced to the reviewer instead of passing quietly.
function factsDelta(oldFacts, newFacts) {
  const size = (f) => (Array.isArray(f?.entryFacts?.size) ? f.entryFacts.size : null);
  const faces = (f) => (Number.isFinite(f?.faceCount) ? f.faceCount : null);
  const before = size(oldFacts);
  const after = size(newFacts);
  if (!before || !after || before.length !== after.length) return null;
  const changePct = before.map((v, i) => (v ? ((after[i] - v) / Math.abs(v)) * 100 : 0));
  const maxAbs = Math.max(0, ...changePct.map((p) => Math.abs(p)));
  return {
    oldSize: before,
    newSize: after,
    changePct: changePct.map((p) => Math.round(p * 10) / 10),
    faceCountBefore: faces(oldFacts),
    faceCountAfter: faces(newFacts),
    withinTolerance: maxAbs <= 5,
  };
}

// Tool feedback must stay valid JSON even when logs are huge: shrink whole
// sections in order instead of slicing the serialized string mid-token.
function toolResultPayload(result) {
  const LIMIT = 12000;
  const payload = {
    ok: result.ok,
    error: result.error || null,
    facts: result.facts,
    stepPath: result.stepPath,
    ...(result.ok && result.factsDelta ? { factsDelta: result.factsDelta } : {}),
    ...(result.ok ? {} : { fixHints: buildFixHints(result) }),
  };
  let log = result.log
    ? {
        exitCode: result.log.exitCode,
        stdout: result.log.stdout.slice(-2500),
        stderr: result.log.stderr.slice(-3000),
      }
    : null;
  let body = JSON.stringify({ ...payload, log });
  if (body.length <= LIMIT) return body;
  if (log) {
    log = { exitCode: result.log.exitCode, stdout: "", stderr: (result.log.stderr || "").slice(-1200) };
    body = JSON.stringify({ ...payload, log });
  }
  if (body.length <= LIMIT) return body;
  if (payload.facts) {
    delete payload.facts;
    body = JSON.stringify({ ...payload, log });
  }
  if (body.length <= LIMIT) return body;
  body = JSON.stringify({ ok: payload.ok, error: payload.error, fixHints: payload.fixHints });
  return body.length > LIMIT ? body.slice(0, LIMIT) : body;
}

function buildFixHints(result) {
  const stderr = (result.log?.stderr || "").toLowerCase();
  const hints = [];
  if (stderr.includes("no attribute") || stderr.includes("cannot import") || stderr.includes("importerror")) {
    hints.push("- Check imports: only use classes/functions that exist in build123d 0.11.1. There is no RectangularHole. Use Hole(radius) for round holes.");
  }
  if (stderr.includes("sortby.z") || stderr.includes("sortby.x") || stderr.includes("sortby.y")) {
    hints.push("- SortBy has NO .Z/.X/.Y members. Use sort_by(Axis.Z), sort_by(Axis.X), etc.");
  }
  if (stderr.includes(".max()") || stderr.includes(".min()")) {
    hints.push("- Selections have NO .max()/.min(). Use .sort_by(Axis.Z)[-1] for highest, [0] for lowest.");
  }
  if (stderr.includes("mode") || stderr.includes("subtract")) {
    hints.push("- To cut geometry, use mode=Mode.SUBTRACT (import Mode from build123d). Bare Cylinder without Mode.SUBTRACT fuses, not cuts.");
  }
  if (stderr.includes("coincident") || stderr.includes("boolean") || stderr.includes("brep")) {
    hints.push("- Coincident boolean faces crash the kernel. Overshoot cuts by ~1 mm beyond each face.");
  }
  if (stderr.includes("fillet") || stderr.includes("chamfer")) {
    hints.push("- Fillets/chamfers fail on edges shorter than the radius. Reduce fillet/chamfer size or apply them only to safe edges.");
  }
  if (stderr.includes("syntax") || stderr.includes("indentation")) {
    hints.push("- Fix Python syntax: check indentation, missing colons, unmatched parentheses.");
  }
  if (stderr.includes("gen_step")) {
    hints.push("- gen_step() must return exactly ONE Solid or labeled Compound. Never return a tuple or None.");
  }
  if (hints.length === 0) {
    hints.push("- Read the traceback carefully and fix the specific line that failed.");
    hints.push("- Ensure all imports are valid build123d 0.11.1 classes.");
  }
  return hints.join("\n");
}

function userContentWithReference(prompt, referenceImage, intro) {
  const text =
    `${intro}\n\nUSER PROMPT\n${prompt}\n\n` +
    "Use the attached image only as design/reference evidence. Infer visible geometry, proportions, features, holes, bends, symmetry, and likely dimensions, but do not invent hidden mechanisms.";
  if (!referenceImage?.dataUrl) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: referenceImage.dataUrl } },
  ];
}

function referenceContext(referenceAnalysis) {
  return referenceAnalysis
    ? `\n\nREFERENCE IMAGE ANALYSIS\n${referenceAnalysis}\n`
    : "";
}

function fallbackSpec({ prompt, routing }) {
  return {
    designName: routing.name || slugFromPrompt(prompt),
    intent: prompt,
    mode: routing.mode,
    assumptions: [],
    dimensions: [],
    features: [{ name: "requested design", type: "base", description: prompt }],
    preserve: [],
    validation: ["Generated CAD should match the request and build successfully."],
  };
}

function fallbackPlan({ spec }) {
  return {
    name: spec.designName || "part",
    strategy: "Build the requested CAD as simple named primitives with robust boolean operations.",
    steps: [
      "Define all dimensions as named millimeter parameters.",
      "Create base geometry first.",
      "Add secondary features.",
      "Apply cuts, holes, and cosmetic edge treatments last.",
      "Return one Solid or labeled Compound from gen_step().",
    ],
    riskControls: ["Avoid coincident boolean faces by overshooting cuts.", "Keep fillets/chamfers small and apply them last."],
    expectedFacts: {},
  };
}

function inferRouting(prompt, sessionSnapshot) {
  const text = prompt.toLowerCase();
  const hasCurrent = Boolean(sessionSnapshot?.current);
  const fresh = /\b(new|separate|different|another|start over|from scratch|ignore previous|fresh)\b/.test(text);
  const modify = /\b(add|attach|put|place|include|make it|change|resize|increase|decrease|remove|replace|on top|above|below|under|same|this|that|it)\b/.test(text);
  return {
    mode: hasCurrent && modify && !fresh ? "modify" : "fresh",
    name: slugFromPrompt(prompt),
    rationale: hasCurrent && modify && !fresh
      ? "Follow-up wording refers to the current CAD design."
      : "Request is treated as a new CAD design.",
  };
}

async function routeRequest({ llm, prompt, sessionSnapshot, onEvent }) {
  const fallback = inferRouting(prompt, sessionSnapshot);
  emitPipeline(onEvent, "routing", 1);
  emitAgent(onEvent, "router", "Router", "running", "Deciding whether this is fresh CAD or a continuation.", { step: 1, totalSteps: 6, phase: "routing" });
  if (!sessionSnapshot?.current) {
    emitAgent(onEvent, "router", "Router", "done", "fresh: no current CAD design exists.", { step: 1, totalSteps: 6, phase: "routing" });
    return fallback;
  }

  onEvent("status", "Router agent: deciding whether this continues the current CAD ...");
  const context = compactDesignContext(sessionSnapshot);
  const message = await llm.chat({
    temperature: 0,
    messages: [
      { role: "system", content: routerPrompt() },
      {
        role: "user",
        content: `${context}\n\nLATEST USER REQUEST\n${prompt}`,
      },
    ],
    onRetry: onLlmRetry(onEvent, "router", "Router", 1, "routing"),
  }).catch(swallowNonRateLimit);

  const parsed = parseJsonObject(message?.content || "");
  const mode = parsed?.mode === "modify" || parsed?.mode === "fresh" ? parsed.mode : fallback.mode;
  const routed = {
    mode,
    name: typeof parsed?.name === "string" && parsed.name.trim() ? parsed.name : fallback.name,
    rationale: typeof parsed?.rationale === "string" && parsed.rationale.trim() ? parsed.rationale : fallback.rationale,
  };
  emitAgent(onEvent, "router", "Router", "done", `${routed.mode}: ${routed.rationale}`, { step: 1, totalSteps: 6, phase: "routing" });
  return routed;
}

async function analyzeReferenceImage({ llm, prompt, referenceImage, onEvent }) {
  emitPipeline(onEvent, "reference", 2);
  if (!referenceImage?.dataUrl) {
    emitAgent(onEvent, "reference", "Reference", "done", "No reference image attached.", { step: 2, totalSteps: 6, phase: "reference" });
    return "";
  }

  emitAgent(onEvent, "reference", "Reference", "running", "Reading the uploaded image before CAD planning.", { step: 2, totalSteps: 6, phase: "reference" });
  onEvent("status", "Reference agent: reading the uploaded image ...");
  const message = await llm.chat({
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a CAD reference-image analyst. Describe the visible part for a CAD builder: overall form, proportions, features, holes/cutouts, symmetry, likely axes, and any uncertainties. Use concise bullet-like sentences. Do not write code.",
      },
      {
        role: "user",
        content: userContentWithReference(prompt, referenceImage, "Analyze this reference image for a text-to-CAD generation task."),
      },
    ],
    onRetry: onLlmRetry(onEvent, "reference", "Reference", 2, "reference"),
  });  const analysis = (message?.content || "").trim();
  emitAgent(onEvent, "reference", "Reference", "done", analysis ? "Reference image understood." : "No useful image details returned.", { step: 2, totalSteps: 6, phase: "reference" });
  return analysis;
}

async function synthesizeSpec({ llm, prompt, routing, sessionSnapshot, referenceAnalysis, aiConfig, onEvent }) {
  emitPipeline(onEvent, "spec", 3);
  emitAgent(onEvent, "spec", "Intake / Spec", "running", "Turning the request into measurable CAD requirements.", { step: 3, totalSteps: 6, phase: "spec" });
  onEvent("status", "Spec agent: making the request precise ...");
  const context = sessionSnapshot?.current ? compactDesignContext(sessionSnapshot) : "";
  const constraints = `\n\nUSER CAD PREFERENCES:\n- Wall Thickness: ${aiConfig?.wallThickness ?? 3.0} mm\n- Boolean Cut Tolerance: ${aiConfig?.defaultTolerance ?? 1.0} mm\n- Fillet Strategy: ${aiConfig?.filletStrategy ?? "moderate"}`;
  const message = await llm.chat({
    temperature: 0.1,
    messages: [
      { role: "system", content: specPrompt() },
      {
        role: "user",
        content:
          `${context}${referenceContext(referenceAnalysis)}\n\nROUTING\n${JSON.stringify(routing)}${constraints}\n\nLATEST USER REQUEST\n${prompt}`,
      },
    ],
    onRetry: onLlmRetry(onEvent, "spec", "Intake / Spec", 3, "spec"),
  }).catch(swallowNonRateLimit);
  const spec = parseJsonObject(message?.content || "") || fallbackSpec({ prompt, routing });
  spec.mode = spec.mode === "modify" || spec.mode === "fresh" ? spec.mode : routing.mode;
  spec.designName = typeof spec.designName === "string" && spec.designName.trim() ? spec.designName : routing.name;
  const assumptions = Array.isArray(spec.assumptions) ? spec.assumptions.length : 0;
  const features = Array.isArray(spec.features) ? spec.features.length : 0;
  emitAgent(onEvent, "spec", "Intake / Spec", "done", `${features} features, ${assumptions} assumptions.`, { step: 3, totalSteps: 6, phase: "spec" });
  return spec;
}

async function planCad({ llm, prompt, routing, sessionSnapshot, referenceAnalysis, aiConfig, onEvent }) {
  emitPipeline(onEvent, "planning", 4);
  emitAgent(onEvent, "planner", "Planner", "running", "Decomposing the CAD into buildable operations.", { step: 4, totalSteps: 6, phase: "planning" });
  onEvent("status", "Planner agent: decomposing the CAD ...");
  const context = sessionSnapshot?.current ? compactDesignContext(sessionSnapshot) : "";
  const constraints = `\n\nUSER CAD PREFERENCES:\n- Wall Thickness: ${aiConfig?.wallThickness ?? 3.0} mm\n- Boolean Cut Tolerance: ${aiConfig?.defaultTolerance ?? 1.0} mm\n- Fillet Strategy: ${aiConfig?.filletStrategy ?? "moderate"}`;
  const message = await llm.chat({
    temperature: 0.1,
    messages: [
      { role: "system", content: plannerPrompt() },
      {
        role: "user",
        content:
          `${context}${referenceContext(referenceAnalysis)}\n\nROUTING\n${JSON.stringify(routing)}${constraints}\n\nRAW REQUEST\n${prompt}`,
      },
    ],
    onRetry: onLlmRetry(onEvent, "planner", "Planner", 4, "planning"),
  }).catch(swallowNonRateLimit);
  const plan = parseJsonObject(message?.content || "") || fallbackPlan({ spec: { designName: routing.name || "cad_part" } });
  plan.name = typeof plan.name === "string" && plan.name.trim() ? plan.name : (routing.name || "cad_part");
  const steps = Array.isArray(plan.steps) ? plan.steps.length : 0;
  emitAgent(onEvent, "planner", "Planner", "done", `${steps} build steps planned.`, { step: 4, totalSteps: 6, phase: "planning" });
  return plan;
}

function designerUserMessage({ prompt, routing, spec, plan, sessionSnapshot, referenceAnalysis, aiConfig }) {
  const briefAndPlan = `CAD BRIEF
${JSON.stringify(spec, null, 2)}

BUILD PLAN
${JSON.stringify(plan, null, 2)}`;

  const constraints = `\nUSER CAD PREFERENCES:\n- Wall Thickness: ${aiConfig?.wallThickness ?? 3.0} mm\n- Boolean Cut Tolerance: ${aiConfig?.defaultTolerance ?? 1.0} mm\n- Fillet Strategy: ${aiConfig?.filletStrategy ?? "moderate"}`;

  if (routing.mode !== "modify" || !sessionSnapshot?.current) {
    return `${referenceContext(referenceAnalysis)}${briefAndPlan}${constraints}

Create a fresh CAD design for this request:
${prompt}`;
  }

  return `${compactDesignContext(sessionSnapshot)}

${referenceContext(referenceAnalysis)}

${briefAndPlan}${constraints}

LATEST USER REQUEST
${prompt}

MODIFY MODE — CONTINUITY RULES
1. START from the CURRENT CAD SOURCE above and return the FULL updated source — never a snippet or diff.
2. Keep every existing dimension variable NAME and VALUE unchanged unless this request explicitly changes it.
3. Do not rename, renumber, remove, restyle, or rebuild existing features. Apply ONLY the requested edits as minimal changes.
4. The result must stay recognizable as the SAME design: keep the overall bounding box within ~5% of the original unless dimensions were explicitly changed.
5. Same contract as before: one gen_step() returning exactly ONE Solid or labeled Compound.`;
}

// Surfaces the modify-run size comparison to the reviewer so silent
// redesigns get flagged instead of summarized away.
function continuityNote(result) {
  const d = result?.factsDelta;
  if (!d) return "";
  return (
    `\nContinuity check (modify run): original size ${JSON.stringify(d.oldSize)} → new size ${JSON.stringify(d.newSize)}` +
    ` (${d.changePct.join("%, ")}% per axis).` +
    (d.withinTolerance
      ? " Overall proportions preserved — confirm the requested change was applied."
      : " WARNING: overall size shifted beyond ~5% without an explicit dimension change. Flag this to the user.")
  );
}

async function reviewResult({ llm, prompt, routing, spec, plan, referenceAnalysis, result, onEvent, signal }) {
  emitPipeline(onEvent, "reviewing", 6);
  emitAgent(onEvent, "reviewer", "Reviewer", "running", "Checking facts and writing the final summary.", { step: 6, totalSteps: 6, phase: "reviewing" });
  const facts = result.facts ? JSON.stringify(result.facts).slice(0, 5000) : "null";
  // Safeguard: the part is already built; if the reviewer stays rate-limited,
  // fall back to a plain summary instead of failing the whole run.
  let message = null;
  try {
    message = await withRateLimitRetry({
      onEvent,
      agentId: "reviewer",
      agentName: "Reviewer",
      step: 6,
      phase: "reviewing",
      signal,
      run: () =>
        llm.chat({
          temperature: 0.2,
          messages: [
            { role: "system", content: reviewerPrompt() },
            {
              role: "user",
              content:
                `User request: ${prompt}\n` +
                `Reference image analysis: ${referenceAnalysis || "(none)"}\n` +
                `Routing: ${JSON.stringify(routing)}\n` +
                `CAD brief: ${JSON.stringify(spec)}\n` +
                `Build plan: ${JSON.stringify(plan)}\n` +
                `Generated slug: ${result.slug}\n` +
                `STEP path: ${result.stepPath}\n` +
                `Facts JSON: ${facts}` +
                continuityNote(result),
            },
          ],
        }).catch(swallowNonRateLimit),
    });
  } catch {
    message = null;
  }
  const summary = message?.content || "";
  emitAgent(onEvent, "reviewer", "Reviewer", "done", "Summary ready.", { step: 6, totalSteps: 6, phase: "reviewing" });
  return summary;
}

export async function runAgent({ prompt, apiKey, provider, model, modelsRoot, sessionSnapshot = null, referenceImage = null, skills = [], aiConfig = { temperature: 0.1, maxIterations: 8, qualityMode: "balanced" }, onEvent = () => {}, signal = null, deadlineMs = 240000 }) {
  const llm = new LLM({ provider, apiKey, model });
  if (signal) llm.setCancelSignal(signal);
  // Whole-run safety clock: slow or hung provider calls, rate-limit waits,
  // and fallback hops all share one hard ceiling so a degraded provider can
  // never stall the pipeline for many minutes.
  const deadlineAt = Date.now() + Math.max(30000, deadlineMs);
  llm.setDeadline(deadlineAt);
  const ensureTime = () => {
    if (Date.now() >= deadlineAt - 2000) {
      throw new LLMDeadlineError(
        `This run hit its ${Math.max(1, Math.round(deadlineMs / 60000))}-minute safety limit — the provider was slow or out of quota. Send again shortly.`
      );
    }
  };
  if (referenceImage?.dataUrl && model && !modelSupportsVision(provider, model)) {
    throw new LLMConfigError(`${model} does not support image input. Pick a vision-capable model or remove the reference image.`);
  }
  // Pre-prompt instructions reach EVERY stage (router, spec, planner,
  // builder) — the settings describe them as prepended to every prompt.
  if (aiConfig?.prePromptInstruction && typeof prompt === "string") {
    prompt = `[USER SYSTEM INSTRUCTION: ${aiConfig.prePromptInstruction}]\n\n${prompt}`;
  }
  // Set once routing resolves: a modify run keeps ONE canonical model dir
  // (same slug, overwritten in place with a .prev.py backup) instead of
  // spawning mounting-block-v2/v3 dirs and drifting into a new design.
  let modifyMode = false;
  onEvent("agent_reset", null);

  let routing, referenceAnalysis = "", spec, plan;

  const retryStep = (agentId, agentName, step, phase, run) =>
    withRateLimitRetry({ onEvent, agentId, agentName, step, phase, run, signal });

  try {
    const routingPromise = retryStep("router", "Router", 1, "routing", () => routeRequest({ llm, prompt, sessionSnapshot, onEvent }))
      .catch(err => {
        emitAgent(onEvent, "router", "Router", "error", err.message || "Router failed.", { step: 1, totalSteps: 6, phase: "routing" });
        throw normalizeError(err);
      });

    const referencePromise = retryStep("reference", "Reference", 2, "reference", () => analyzeReferenceImage({ llm, prompt, referenceImage, onEvent }))
      .catch(err => {
        emitAgent(onEvent, "reference", "Reference", "error", err.message || "Reference analysis failed.", { step: 2, totalSteps: 6, phase: "reference" });
        throw normalizeError(err);
      });

    [routing, referenceAnalysis] = await Promise.all([routingPromise, referencePromise]);
  } catch (err) {
    throw err;
  }
  // Locked in AFTER the router so the final routed mode — LLM verdict or
  // heuristic fallback — decides continuity, not a stale pre-routing guess.
  modifyMode = routing.mode === "modify" && Boolean(sessionSnapshot?.current?.pythonSource);

  try {
    const specPromise = retryStep("spec", "Intake / Spec", 3, "spec", () => synthesizeSpec({ llm, prompt, routing, sessionSnapshot, referenceAnalysis, aiConfig, onEvent }))
      .catch(err => {
        emitAgent(onEvent, "spec", "Intake / Spec", "error", err.message || "Spec failed.", { step: 3, totalSteps: 6, phase: "spec" });
        throw normalizeError(err);
      });

    const planPromise = retryStep("planner", "Planner", 4, "planning", () => planCad({ llm, prompt, routing, sessionSnapshot, referenceAnalysis, aiConfig, onEvent }))
      .catch(err => {
        emitAgent(onEvent, "planner", "Planner", "error", err.message || "Planner failed.", { step: 4, totalSteps: 6, phase: "planning" });
        throw normalizeError(err);
      });

    [spec, plan] = await Promise.all([specPromise, planPromise]);
  } catch (err) {
    throw err;
  }

  const fallbackName = plan.name || spec.designName || routing.name || slugFromPrompt(prompt);
  // Modify runs keep the CURRENT design's slug so history entries stay
  // anchored to one canonical part — not a new slug from the follow-up.
  const modifySlug = modifyMode && sessionSnapshot?.current?.slug
    ? sessionSnapshot.current.slug
    : null;

  const messages = [
    { role: "system", content: systemPrompt(skills) },
    { role: "user", content: designerUserMessage({ prompt, routing, spec, plan, sessionSnapshot, referenceAnalysis, aiConfig }) },
  ];

  let lastResult = null;
  let iterationsUsed = 0;
  let lastReasoning = undefined;

  async function runGenerate(args) {
    const name = modifySlug
      ? modifySlug
      : (typeof args?.name === "string" && args.name.trim() ? args.name : fallbackName);
    const pythonSource = typeof args?.python_source === "string" ? args.python_source : "";
    if (!pythonSource.trim()) {
      return { ok: false, error: "generate_cad was called without python_source." };
    }
    const codeLines = pythonSource.trim().split("\n");
    const codeSnippet = codeLines.slice(0, 4).join("\n") + (codeLines.length > 4 ? "\n# ... (" + codeLines.length + " lines total)" : "");
    emitPipeline(onEvent, "building", 5);
    emitAgent(onEvent, "builder", "Builder", "running", "Building " + name + " with build123d.", { step: 5, totalSteps: 6, phase: "building", codeSnippet });
    onEvent("status", "Builder agent: building " + name + " ...");
    const result = await generatePart({ name, pythonSource, modelsRoot, signal, overwrite: Boolean(modifySlug) });
    lastResult = result;
    if (result.canceled) throw canceledError();
    // Continuity check on modify runs: compare the rebuilt part's size
    // against the previous design so silent redesigns get caught.
    if (result.ok && modifyMode) {
      result.factsDelta = factsDelta(sessionSnapshot?.current?.facts, result.facts);
    }
    emitAgent(onEvent, "builder", "Builder", result.ok ? "done" : "error", result.ok ? "CAD build completed." : (result.error || "CAD build failed."), { step: 5, totalSteps: 6, phase: "building" });
    return result;
  }

  async function callModel(extraMessages = []) {
    emitPipeline(onEvent, "building", 5);
    emitAgent(onEvent, "builder", "Builder", "running", "Writing parametric build123d source.", { step: 5, totalSteps: 6, phase: "building" });
    onEvent("status", "Builder agent: designing with " + (llm.model || model || "the selected model") + " ...");
    // Rate limits retry the same turn here (messages intact, no iteration
    // consumed) instead of killing the build loop.
    return withRateLimitRetry({
      onEvent,
      agentId: "builder",
      agentName: "Builder",
      step: 5,
      phase: "building",
      signal,
      run: async () => {
        try {
          let temp = aiConfig.temperature;
          if (aiConfig.qualityMode === "fast") temp = 0.05;
          if (aiConfig.qualityMode === "thorough") temp = Math.min(1.0, temp + 0.1);
          return await llm.chat({
            messages: [...messages, ...extraMessages],
            tools: TOOLS,
            temperature: temp,
            onRetry: (info) => {
              emitAgent(onEvent, "builder", "Builder", "running",
                `Rate limited — waiting ${Math.max(1, Math.round(info.delayMs / 1000))}s (try ${info.attempt} of ${info.maxAttempts})`,
                { step: 5, totalSteps: 6, phase: "building" });
              onEvent("status", "Builder agent: rate limited — backing off and retrying ...");
            },
          });
        } catch (err) {
          throw normalizeError(err);
        }
      },
    });
  }

  let iterationsLimit = aiConfig.maxIterations;
  if (aiConfig.qualityMode === "fast") iterationsLimit = Math.min(iterationsLimit, 4);
  if (aiConfig.qualityMode === "thorough") iterationsLimit = Math.max(iterationsLimit, 12);

  for (let i = 0; i < iterationsLimit; i++) {
    if (signal?.aborted) throw canceledError();
    ensureTime();
    iterationsUsed = i + 1;
    const message = await callModel();
    if (typeof message.reasoning_content === "string") {
      lastReasoning = message.reasoning_content;
      onEvent("thought", lastReasoning);
    }

    // Success path: we already have valid artifacts and the model replies in prose.
    if (lastResult?.ok && !message.tool_calls) {
      return finish(lastResult, message.content);
    }

    if (message.tool_calls?.length) {
      messages.push(message);
      let lastOk = null;
      for (const call of message.tool_calls) {
        if (call.function.name !== "generate_cad") continue;
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await runGenerate(args);
        lastOk = result;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolResultPayload(result),
        });
        if (result.ok) onEvent("artifact", result);
      }
      if (lastOk?.ok) {
        let summary = "Part generated successfully.";
        if (aiConfig.qualityMode !== "fast") {
          onEvent("status", "Reviewer agent: checking the generated CAD ...");
          summary = await reviewResult({ llm, prompt, routing, spec, plan, referenceAnalysis, result: lastOk, onEvent, signal });
        } else {
          onEvent("status", "Reviewer agent: skipped in fast mode.");
        }
        return finish(lastOk, summary);
      }
      continue;
    }

    // No tool call: salvage inline fenced Python, or nudge the model back on track.
    const text = message.content || "";
    const code = extractFencedCode(text);
    if (code) {
      const result = await runGenerate({ name: fallbackName, python_source: code });
      if (result.ok) {
        onEvent("artifact", result);
        return finish(result, text.replace(/```[\s\S]*```/s, "").trim() || "");
      }
      messages.push({ role: "assistant", content: text, ...(lastReasoning ? { reasoning_content: lastReasoning } : {}) });
      const traceback = extractTraceback(result.log?.stderr || "");
      messages.push({
        role: "user",
        content:
          "The generated Python failed to build.\n\n" +
          "ERROR: " + (result.error || "unknown") + "\n\n" +
          (traceback ? "TRACEBACK:\n" + traceback + "\n\n" : "") +
          "COMMON FIXES:\n" +
          buildFixHints(result) + "\n\n" +
          "Fix the code and call generate_cad again. Do NOT repeat the same mistake.",
      });
      continue;
    }

    if (lastResult?.ok) return finish(lastResult, text);
    messages.push({ role: "assistant", content: text, ...(lastReasoning ? { reasoning_content: lastReasoning } : {}) });
    messages.push({
      role: "user",
      content:
        "You must call the generate_cad tool with a name and a valid python_source (one gen_step() returning a single value).",
    });
  }

  if (lastResult?.ok) return finish(lastResult, "");
  throw new Error(
    (lastResult?.error || "The model could not produce a valid part.") +
      "\n\nAfter " + iterationsLimit + " attempts, the build is still failing. " +
        "Try simplifying the request, breaking it down into smaller steps, or using a more powerful model via the AI Config settings."
  );

  function finish(result, summaryText) {
    const summary =
      summaryText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !l.startsWith("```"))
        .join("\n")
        .trim() || "Part generated successfully.";
    return {
      ok: true,
      artifacts: {
        slug: result.slug,
        dir: result.dir,
        sourcePath: result.sourcePath,
        pythonSource: result.pythonSource,
        stepPath: result.stepPath,
        glbPath: result.glbPath,
        stlPath: result.stlPath,
        viewerGlb: result.viewerGlb,
        facts: result.facts,
      },
      model: llm.model || model,
      routing,
      spec,
      plan,
      referenceAnalysis,
      factsDelta: result.factsDelta || null,
      iterations: iterationsUsed,
      summary,
    };
  }
}
