const form = document.getElementById("chat-form");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("send-btn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("model");

let catalog = null;
const selectedByProvider = {};

function populateProviders() {
  providerSelect.innerHTML = "";
  for (const [id, info] of Object.entries(catalog.providers || {})) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${info.label}${info.hasKey ? "" : " (no key)"}`;
    providerSelect.appendChild(opt);
  }
  providerSelect.value = catalog.defaultProvider || providerSelect.options[0]?.value || "gemini";
}

function populateModels() {
  const provider = providerSelect.value;
  const models = catalog.providers?.[provider]?.models || [];
  const previous = selectedByProvider[provider] || catalog.defaultModel;
  modelSelect.innerHTML = "";

  if (!models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Add this provider key in .env";
    modelSelect.appendChild(opt);
    modelSelect.disabled = true;
    return;
  }

  for (const model of models) {
    const opt = document.createElement("option");
    opt.value = model.id;
    opt.textContent = model.label || model.id;
    modelSelect.appendChild(opt);
  }
  modelSelect.disabled = false;
  const ids = models.map((m) => m.id);
  modelSelect.value = previous && ids.includes(previous) ? previous : ids[0];
  selectedByProvider[provider] = modelSelect.value;
}

async function loadModels() {
  statusEl.hidden = false;
  statusEl.textContent = "Loading model catalog...";
  try {
    const res = await fetch("/api/models");
    catalog = await res.json();
    populateProviders();
    populateModels();
    statusEl.hidden = true;
  } catch {
    statusEl.textContent = "Could not load models. Is the server running?";
    statusEl.className = "status error";
  }
}

providerSelect.addEventListener("change", populateModels);
modelSelect.addEventListener("change", () => {
  selectedByProvider[providerSelect.value] = modelSelect.value;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  sendBtn.disabled = true;
  outputEl.hidden = true;
  statusEl.hidden = false;
  statusEl.textContent = "Thinking...";
  statusEl.className = "status";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        provider: providerSelect.value,
        model: modelSelect.value,
      }),
    });

    const data = await res.json().catch(() => ({}));

    statusEl.hidden = true;

    if (!res.ok) {
      outputEl.hidden = false;
      outputEl.textContent = data.error || "Something went wrong. Please try again.";
      outputEl.className = "output error";
      return;
    }

    outputEl.hidden = false;
    outputEl.textContent = data.response || "(empty response)";
    outputEl.className = "output";
  } catch (err) {
    statusEl.hidden = true;
    outputEl.hidden = false;
    outputEl.textContent = "Network error. Is the server running?";
    outputEl.className = "output error";
  } finally {
    sendBtn.disabled = false;
  }
});

loadModels();
