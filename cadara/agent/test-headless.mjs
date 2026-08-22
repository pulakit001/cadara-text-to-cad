import "dotenv/config";
import path from "node:path";
import { runAgent } from "./agent.mjs";
import { PROVIDERS, listModels } from "./llm.mjs";

const prompt =
  process.argv[2] ||
  "Create a centered 100 x 60 x 20 mm block with four 8 mm vertical through-holes. Add only a 2 mm chamfer on the top outer perimeter.";

const modelsRoot = path.resolve(import.meta.dirname, "..", "models");

const providerId = process.env.LLM_PROVIDER || "gemini";
const provider = PROVIDERS[providerId];
if (!provider) {
  console.error(`Unknown LLM_PROVIDER "${providerId}" — use gemini, zai, qwen, openai, claude, or openrouter.`);
  process.exit(1);
}
const apiKey = process.env[provider.keyEnv];
if (!apiKey) {
  console.error(`${provider.keyEnv} is not set in .env — needed for a headless run.`);
  process.exit(1);
}

let model = process.env.LLM_MODEL || "";
if (!model) {
  const catalog = await listModels(providerId, apiKey);
  model = catalog[0]?.id || "";
  console.log(`[auto] no LLM_MODEL set — using first catalog model: ${model}`);
}

runAgent({
  prompt,
  apiKey,
  provider: providerId,
  model,
  modelsRoot,
  onEvent: (type, payload) => {
    if (type === "status") console.log("[status]", payload);
    if (type === "agent") console.log("[agent]", payload.name + ":", payload.status, "-", payload.detail || "");
    if (type === "error") console.log("[error]", payload);
    if (type === "artifact") console.log("[artifact]", payload.stepPath, "facts:", JSON.stringify(payload.facts).slice(0, 400));
  },
})
  .then((result) => {
    console.log("\n=== RESULT ===");
    console.log("ok:", result.ok, "| iterations:", result.iterations, "| provider:", providerId, "| model:", result.model);
    console.log("step:", result.artifacts.stepPath);
    console.log("glb:", result.artifacts.glbPath);
    console.log("stl:", result.artifacts.stlPath);
    console.log("summary:", result.summary);
  })
  .catch((err) => {
    console.error("\n=== FAILED ===");
    console.error(err.name, "-", err.message);
    process.exit(1);
  });
