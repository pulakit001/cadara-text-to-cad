import { createViewer } from "./assets/viewer.js";

const cadara = window.cadara || {
  meta: async () => ({
    modelsRoot: "",
    providers: {
      gemini: {
        label: "Gemini",
        hasKey: true,
        models: FALLBACK_CATALOGS.gemini,
        packets: FALLBACK_PACKETS.gemini,
      },
      zai: {
        label: "Z.AI",
        hasKey: false,
        models: FALLBACK_CATALOGS.zai,
        packets: FALLBACK_PACKETS.zai,
      },
    },
    defaultProvider: "gemini",
    defaultModel: "gemini-3.1-flash-lite",
  }),
  settings: {
    get: async () => ({ hasGeminiKey: true }),
    getKeys: async () => ({}),
    set: async () => ({ ok: true }),
    test: async () => ({ ok: true }),
  },
  chat: {
    send: async () => ({ ok: false, error: "Preview mode: Electron bridge is not connected." }),
    cancel: async () => ({ ok: true }),
    onEvent: () => () => {},
  },
  file: { save: async () => ({ ok: true }) },
  session: { clear: async () => ({ ok: true }) },
  texture: { generate: (description) => Promise.resolve({ ok: true, spec: localTextureSpec(description) }) },
  history: {
    list: async () => previewHistory,
    save: async (entry) => {
      if (!entry?.id) return { ok: false };
      previewHistory = [entry, ...previewHistory.filter((d) => d.id !== entry.id)];
      return { ok: true };
    },
    remove: async (id) => {
      previewHistory = previewHistory.filter((d) => d.id !== id);
      return { ok: true };
    },
    clear: async () => {
      previewHistory = [];
      return { ok: true };
    },
    importLegacy: async () => ({ ok: true }),
  },
};
const previewHistory = [];

window.__errors = [];
window.addEventListener("error", (e) => window.__errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason)));

// Offline fallback catalogs (id + label with tier/price), used only until
// the live list arrives from the main process.
const FALLBACK_CATALOGS = {
  gemini: [
    { id: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite — free tier · $0.25 / $1.50 per 1M tok", supportsVision: true },
    { id: "gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite — free tier · $0.30 / $2.50 per 1M tok", supportsVision: true },
    { id: "gemini-3.6-flash", label: "gemini-3.6-flash — free tier · $0.75 / $3.75 per 1M tok through 2026", supportsVision: true },
    { id: "gemini-3.7-flash", label: "gemini-3.7-flash — free tier · $0.75 / $3.75 per 1M tok through 2026", supportsVision: true },
  ],
  zai: [
    { id: "glm-4.7-flash", label: "glm-4.7-flash — fast tier · lowest GLM cost", supportsVision: false },
    { id: "glm-4.5-air", label: "glm-4.5-air — fast tier · lowest GLM cost", supportsVision: false },
    { id: "glm-4.7", label: "glm-4.7 — balanced · mid GLM cost tier", supportsVision: true },
    { id: "glm-4.6", label: "glm-4.6 — balanced · mid GLM cost tier", supportsVision: true },
  ],
  qwen: [
    { id: "qwen3-turbo", label: "qwen3-turbo — fast tier · lowest Qwen cost", supportsVision: false },
    { id: "qwen-turbo", label: "qwen-turbo — fast tier · lowest Qwen cost", supportsVision: false },
    { id: "qwen3-plus", label: "qwen3-plus — balanced · mid Qwen cost tier", supportsVision: false },
    { id: "qwen3-max", label: "qwen3-max — flagship · highest Qwen quality tier", supportsVision: false },
  ],
  openai: [
    { id: "gpt-5-nano", label: "gpt-5-nano — efficient · lowest OpenAI cost tier", supportsVision: true },
    { id: "gpt-5-mini", label: "gpt-5-mini — balanced · lower cost than flagship GPT-5", supportsVision: true },
    { id: "gpt-5", label: "gpt-5 — premium · flagship OpenAI tier", supportsVision: true },
  ],
  claude: [
    { id: "claude-haiku-4-5", label: "claude-haiku-4-5 — efficient · lowest Claude cost tier", supportsVision: true },
    { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5 — balanced · mid Claude cost tier", supportsVision: true },
    { id: "claude-opus-4-1", label: "claude-opus-4-1 — ultra · highest Claude quality tier", supportsVision: true },
  ],
  openrouter: [
    { id: "google/gemini-2.5-flash", label: "google/gemini-2.5-flash — balanced · tool calling", supportsVision: true },
    { id: "openai/gpt-4.1-mini", label: "openai/gpt-4.1-mini — efficient · tool calling", supportsVision: true },
    { id: "anthropic/claude-haiku-4.5", label: "anthropic/claude-haiku-4.5 — efficient · tool calling", supportsVision: true },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "meta-llama/llama-3.3-70b-instruct — balanced · tool calling", supportsVision: false },
    { id: "anthropic/claude-sonnet-4.5", label: "anthropic/claude-sonnet-4.5 — flagship · tool calling", supportsVision: true },
    { id: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro — flagship · tool calling", supportsVision: true },
  ],
};

const FALLBACK_PACKETS = {
  gemini: [
    { id: "gemini-free", label: "Gemini Free", cost: "lowest", priceNote: "Flash Lite / free-tier friendly.", description: "Fastest cheap default.", model: "gemini-3.1-flash-lite", supportsVision: true },
    { id: "gemini-efficient", label: "Gemini Efficient", cost: "low", priceNote: "Small cost increase.", description: "Better everyday CAD planning.", model: "gemini-3.6-flash", supportsVision: true },
    { id: "gemini-paid", label: "Gemini Paid", cost: "medium", priceNote: "Uses stronger paid models.", description: "Better for multi-feature parts.", model: "gemini-3.7-flash", supportsVision: true },
  ],
  zai: [
    { id: "zai-fast", label: "Z.AI Fast", cost: "lowest", priceNote: "Fastest, cheapest GLM route.", description: "Quick text-only CAD generation.", model: "glm-4.7-flash", supportsVision: false },
    { id: "zai-balanced", label: "Z.AI Balanced", cost: "low-medium", priceNote: "Stronger reasoning for repair loops.", description: "Everyday CAD preset with solid tool calling.", model: "glm-4.7", supportsVision: true },
    { id: "zai-ultra", label: "Ultra Z.AI", cost: "highest", priceNote: "Highest GLM quality.", description: "Best GLM option where quality beats thrift.", model: "glm-5.1", supportsVision: false },
  ],
  qwen: [
    { id: "qwen-fast", label: "Qwen Fast", cost: "lowest", priceNote: "Lowest-cost DashScope preset.", description: "Very fast text-only CAD generation.", model: "qwen3-turbo", supportsVision: false },
    { id: "qwen-balanced", label: "Qwen Balanced", cost: "low-medium", priceNote: "Stronger reasoning than Fast.", description: "Balanced preset for measurements and build steps.", model: "qwen3-plus", supportsVision: false },
    { id: "qwen-ultra", label: "Ultra Qwen", cost: "highest", priceNote: "Uses Qwen's flagship model.", description: "Best Qwen option for hard prompts.", model: "qwen3-max", supportsVision: false },
  ],
  openai: [
    { id: "openai-efficient", label: "OpenAI Efficient", cost: "lowest", priceNote: "Lowest OpenAI preset.", description: "Cheap quick tool-calling.", model: "gpt-5-nano", supportsVision: true },
    { id: "openai-performance", label: "OpenAI Performance", cost: "medium", priceNote: "Higher cost for stronger CAD reasoning.", description: "Better constraints and image interpretation.", model: "gpt-5-mini", supportsVision: true },
    { id: "openai-ultra", label: "OpenAI Ultra", cost: "highest", priceNote: "Highest OpenAI quality/cost preset.", description: "Hardest prompts and complex images.", model: "gpt-5", supportsVision: true },
  ],
  claude: [
    { id: "claude-efficient", label: "Claude Efficient", cost: "lowest", priceNote: "Lowest Claude preset.", description: "Cheap drafting and spec cleanup.", model: "claude-haiku-4-5", supportsVision: true },
    { id: "claude-performance", label: "Claude Performance", cost: "medium", priceNote: "Higher cost, stronger planning.", description: "Careful multi-step CAD plans.", model: "claude-sonnet-4-5", supportsVision: true },
    { id: "claude-ultra", label: "Claude Ultra", cost: "highest", priceNote: "Highest Claude quality/cost preset.", description: "Complex specs and image-guided CAD.", model: "claude-opus-4-1", supportsVision: true },
  ],
  openrouter: [
    { id: "or-efficient", label: "OR Efficient", cost: "lowest", priceNote: "Low cost models via OpenRouter.", description: "Cheap drafting and simple CAD generation.", model: "google/gemini-2.5-flash", supportsVision: true },
    { id: "or-performance", label: "OR Performance", cost: "medium", priceNote: "Balanced cost and capability.", description: "Strong CAD reasoning from flagship models.", model: "anthropic/claude-sonnet-4.5", supportsVision: true },
    { id: "or-ultra", label: "OR Ultra", cost: "highest", priceNote: "Premium models via OpenRouter.", description: "Complex logic and geometry.", model: "google/gemini-2.5-pro", supportsVision: true },
  ],
  ollama: [
    { id: "ollama-fast", label: "Local Fast", cost: "free", priceNote: "Runs on your machine.", description: "Qwen2.5-Coder 7B for simple local CAD.", model: "qwen2.5-coder:7b", supportsVision: false },
    { id: "ollama-balanced", label: "Local Balanced", cost: "free", priceNote: "Runs on your machine.", description: "Qwen2.5-Coder 14B, better geometry code.", model: "qwen2.5-coder:14b", supportsVision: false },
    { id: "ollama-max", label: "Local Max", cost: "free", priceNote: "Runs on your machine.", description: "Qwen3-Coder 30B MoE — best local CAD quality.", model: "qwen3-coder:30b", supportsVision: false },
  ],
};

const els = {
  providerSelect: document.getElementById("provider-select"),
  historyBtn: document.getElementById("history-btn"),
  historyPopover: document.getElementById("history-popover"),
  historyList: document.getElementById("history-list"),
  historyClearBtn: document.getElementById("history-clear-btn"),
  historySearch: document.getElementById("history-search"),
  modelSelect: document.getElementById("model-select"),
  settingsBtn: document.getElementById("settings-btn"),
  helpBtn: document.getElementById("help-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  modal: document.getElementById("modal"),
  settingsClose: document.getElementById("settings-close"),
  helpModal: document.getElementById("help-modal"),
  helpClose: document.getElementById("help-close"),
  settingsNavBtns: document.querySelectorAll('.settings-nav-btn'),
  settingsPanels: document.querySelectorAll('.settings-panel'),
  settingsContentTitle: document.getElementById("settings-content-title"),
  providerSections: document.querySelector(".provider-sections"),
  addKeyDialog: document.getElementById("add-key-dialog"),
  addKeyForm: document.getElementById("add-key-form"),
  addKeyTitle: document.getElementById("add-key-title"),
  addKeyProvider: document.getElementById("add-key-provider"),
  addKeyLabel: document.getElementById("add-key-label"),
  addKeyValue: document.getElementById("add-key-value"),
  addKeyCancel: document.getElementById("add-key-cancel"),
  createSkillBtn: document.getElementById('create-skill-btn'),
  skillForm: document.getElementById('skill-form'),
  skillCancelBtn: document.getElementById('skill-cancel-btn'),
  skillName: document.getElementById('skill-name'),
  skillBody: document.getElementById('skill-body'),
  skillsList: document.getElementById('skills-list'),
  skillsNote: document.getElementById('skills-note'),
  chat: document.getElementById("chat"),
  suggestions: document.getElementById("suggestions"),
  agentTrace: document.getElementById("agent-trace"),
  agentList: document.getElementById("agent-list"),
  traceTotalTimer: document.getElementById("trace-total-timer"),
  prompt: document.getElementById("prompt"),
  promptForm: document.getElementById("prompt-form"),
  referenceUploader: document.getElementById("reference-uploader"),
  referenceInput: document.getElementById("reference-input"),
  referenceBtn: document.getElementById("reference-btn"),
  referencePreview: document.getElementById("reference-preview"),
  referenceThumb: document.getElementById("reference-thumb"),
  referenceName: document.getElementById("reference-name"),
  referenceNote: document.getElementById("reference-note"),
  referenceRemove: document.getElementById("reference-remove"),
  sendBtn: document.getElementById("send-btn"),
  cancelBtn: document.getElementById("cancel-btn"),

  // Tune panel (design constraint sliders)
  tuneBtn: document.getElementById("tune-btn"),
  tunePanel: document.getElementById("tune-panel"),
  tuneResetBtn: document.getElementById("tune-reset"),
  tuneSliders: Array.from(document.querySelectorAll(".tune-panel input[type=range]")),

  // Projects Home
  landingPage: document.getElementById("landing-page"),
  homeBtn: document.getElementById("home-btn"),
  projectsGrid: document.getElementById("projects-grid"),
  projectsResumeBtn: document.getElementById("projects-resume-btn"),
  projectsResumeLabel: document.getElementById("projects-resume-label"),
  projectRenameModal: document.getElementById("project-rename-modal"),
  projectRenameInput: document.getElementById("project-rename-input"),
  projectRenameSave: document.getElementById("project-rename-save"),
  projectRenameCancel: document.getElementById("project-rename-cancel"),

  retryBtn: document.getElementById("retry-btn"),
  iterChip: document.getElementById("iter-chip"),
  viewerEmpty: document.getElementById("viewer-empty"),
  viewerOverlay: document.getElementById("viewer-overlay"),

  viewerLoading: document.getElementById("viewer-loading"),
  viewerLoadingText: document.getElementById("viewer-loading-text"),
  artifactName: document.getElementById("artifact-name"),
  artifactDims: document.getElementById("artifact-dims"),
  resetView: document.getElementById("reset-view"),
  texturePanel: document.getElementById("texture-panel"),
  textureInput: document.getElementById("texture-input"),
  textureOk: document.getElementById("texture-ok"),
  textureClose: document.getElementById("texture-close"),
  textureTab: document.getElementById("texture-tab"),
  textureStatus: document.getElementById("texture-status"),
  textureRemove: document.getElementById("texture-remove"),
  textureProviderSelect: document.getElementById("texture-provider-select"),
  textureModelSelect: document.getElementById("texture-model-select"),
  
  exportBtn: document.getElementById("export-btn"),
  exportPopup: document.getElementById("export-popup"),
  exportClose: document.getElementById("export-close"),
  formatBtns: document.querySelectorAll(".format-btn"),
  exportProgress: document.getElementById("export-progress"),
  progressBarFill: document.getElementById("progress-bar-fill"),
  progressStatus: document.getElementById("progress-status"),
  exportDone: document.getElementById("export-done"),
  exportPath: document.getElementById("export-path"),
  exportReveal: document.getElementById("export-reveal"),

  // Part details drawer
  detailsBtn: document.getElementById("details-btn"),
  detailsDrawer: document.getElementById("details-drawer"),
  detailsClose: document.getElementById("details-close"),
  detailsSummary: document.getElementById("details-summary"),
  detailsFeaturesSec: document.getElementById("details-features-sec"),
  detailsFeatures: document.getElementById("details-features"),
  detailsAssumptionsSec: document.getElementById("details-assumptions-sec"),
  detailsAssumptions: document.getElementById("details-assumptions"),
  detailsGeometrySec: document.getElementById("details-geometry-sec"),
  detailsGeometry: document.getElementById("details-geometry"),
  detailsMetaSec: document.getElementById("details-meta-sec"),
  detailsMeta: document.getElementById("details-meta"),

  // Local models (Ollama)
  ollamaStatusDot: document.getElementById("ollama-status-dot"),
  ollamaStatusText: document.getElementById("ollama-status-text"),
  ollamaInstallLink: document.getElementById("ollama-install-link"),
  ollamaRefreshBtn: document.getElementById("ollama-refresh-btn"),
  ollamaRecommended: document.getElementById("ollama-recommended"),
  ollamaInstalled: document.getElementById("ollama-installed"),
  ollamaLocalNote: document.getElementById("ollama-local-note"),
};

const EXAMPLE_PROMPTS = [
  "A 60 × 40 × 15 mm block with two 6 mm through-holes centered 15 mm from each end",
  "A 40 mm diameter, 8 mm thick disc with a 10 mm center bore and six 4 mm holes on a 28 mm circle",
  "A hollow enclosure 80 × 60 × 40 mm with 3 mm walls, open top, and four M3 standoffs inside",
];

const PROVIDER_LABELS = {
  gemini: "Gemini",
  zai: "Z.AI",
  qwen: "Qwen",
  openai: "OpenAI",
  claude: "Claude",
  openrouter: "OpenRouter",
  ollama: "Ollama (Local)",
};

let modelsRoot = "";
let meta = null;
let busy = false;
let lastArtifact = null;
let lastExportPath = null;
let lastResultInfo = null;
let viewer = null;
let unsubEvents = null;
let doneReceived = false;
let hasKey = false;
let lastPrompt = "";
let autoRetryCount = 0;
let activeChatId = null;
let currentTranscript = [];
let lastReferenceImageForPrompt = null;
let activeClientJobId = null;
let runSerial = 0;
let retryTimer = null;
const agentState = new Map();
const providerCatalogs = { gemini: null, zai: null, qwen: null, openai: null, claude: null, openrouter: null, ollama: null };
const providerPackets = { gemini: null, zai: null, qwen: null, openai: null, claude: null, openrouter: null, ollama: null };
const selectedModelByProvider = { gemini: null, zai: null, qwen: null, openai: null, claude: null, openrouter: null, ollama: null };
const selectedPacketByProvider = { gemini: null, zai: null, qwen: null, openai: null, claude: null, openrouter: null, ollama: null };

// Pipeline dashboard state
let pipelineStartedAt = null;
let pipelineTimerInterval = null;
const stepStartTimes = new Map();
const stepEndTimes = new Map();
let activeAgentId = null;
let lastThinkingText = "";

const viewerEl = document.getElementById("viewer");
const HISTORY_KEY = "cadara.previousChats.v1";
const PROJECTS_KEY = "cadara.projects.v1";
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EMPTY_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
let referenceImage = null;

function selectedModelInfo() {
  const provider = currentProvider();
  const catalog = providerCatalogs[provider] || FALLBACK_CATALOGS[provider] || [];
  return catalog.find((m) => m.id === els.modelSelect.value) || null;
}

function selectedModelSupportsVision() {
  const info = selectedModelInfo();
  if (typeof info?.supportsVision === "boolean") return info.supportsVision;
  const provider = currentProvider();
  if (provider === "gemini") return /^gemini-/i.test(els.modelSelect.value || "");
  if (provider === "zai") return /glm-4\.5v|glm-4\.6v|glm-[45]\.[0-9]+v|glm-4\.6$|glm-4\.7$|^glm-5/i.test(els.modelSelect.value || "");
  if (provider === "qwen") return false;
  if (provider === "openai") return /gpt-[45]|o[34]|vision|omni/i.test(els.modelSelect.value || "");
  if (provider === "claude") return /^claude-/i.test(els.modelSelect.value || "");
  if (provider === "ollama") {
    // Local vision families (Qwen-VL, LLaVA, Gemma, MiniCPM…). Local catalog
    // entries carry no supportsVision flag, so detect from the id.
    return /(^|[-_:])vl\b|vision|llava|gemma|minicpm|moondream/i.test(els.modelSelect.value || "");
  }
  return false;
}

function populateModels(provider) {
  let catalog;
  if (provider === "ollama") {
    // Only models actually downloaded on this machine may be selected — the
    // live catalog from Ollama IS the list. Never fall back to the
    // recommended presets here; those belong to the download panel.
    catalog = Array.isArray(providerCatalogs[provider]) ? providerCatalogs[provider] : [];
  } else {
    catalog = providerCatalogs[provider] || FALLBACK_CATALOGS[provider] || [];
  }
  const previous = selectedModelByProvider[provider];
  const preferred =
    (meta &&
      ((provider === (meta.defaultProvider || provider) && meta.defaultModel) || null)) ||
    previous;
  els.modelSelect.innerHTML = "";
  if (provider === "ollama" && catalog.length === 0) {
    // Nothing downloaded yet (or Ollama isn't running) — show a hint instead
    // of an empty dropdown, and point at the download panel.
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No local models — Settings → Local Models";
    opt.disabled = true;
    opt.selected = true;
    els.modelSelect.appendChild(opt);
    selectedModelByProvider[provider] = "";
    updateReferenceControls();
    return;
  }
  catalog.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = compactModelLabel(provider, m.id);
    opt.title = m.label || m.id;
    els.modelSelect.appendChild(opt);
  });
  const ids = catalog.map((m) => m.id);
  els.modelSelect.value =
    (preferred && ids.includes(preferred) ? preferred : null) || ids[0] || "";
  selectedModelByProvider[provider] = els.modelSelect.value;
  updateReferenceControls();
}

function populateTextureModels(provider) {
  let catalog;
  if (provider === "ollama") {
    catalog = Array.isArray(providerCatalogs[provider]) ? providerCatalogs[provider] : [];
  } else {
    catalog = providerCatalogs[provider] || FALLBACK_CATALOGS[provider] || [];
  }
  els.textureModelSelect.innerHTML = "";
  if (provider === "ollama" && catalog.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No local models";
    opt.disabled = true;
    opt.selected = true;
    els.textureModelSelect.appendChild(opt);
    return;
  }
  catalog.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = compactModelLabel(provider, m.id);
    opt.title = m.label || m.id;
    els.textureModelSelect.appendChild(opt);
  });
  if (catalog.length > 0) {
    els.textureModelSelect.value = catalog[0].id;
  }
}

function compactModelLabel(provider, modelId) {
  if (provider === "gemini") {
    return modelId
      .replace(/^gemini-/i, "")
      .replace(/-/g, " ");
  }
  if (provider === "zai" || provider === "qwen") {
    return modelId;
  }
  if (provider === "openai") return modelId.replace(/-/g, " ");
  if (provider === "ollama") {
    // Local ids like qwen2.5-coder:7b read best with the tag spelled out.
    return modelId.replace(/:latest$/i, "").replace(":", " · ");
  }
  if (provider === "claude") {
    return modelId
      .replace(/^claude-/i, "")
      .replace(/-/g, " ");
  }
  return modelId;
}

function populateProviderControls(provider) {
  populateModels(provider);
}

function currentProvider() {
  return els.providerSelect.value || "gemini";
}

function init() {
  updateExportAvailability();
  populateProviderControls(els.providerSelect.value || "gemini");
  populateTextureModels(els.textureProviderSelect.value || "gemini");
  els.providerSelect.addEventListener("change", () => {
    populateProviderControls(currentProvider());
  });
  els.modelSelect.addEventListener("change", () => {
    selectedModelByProvider[currentProvider()] = els.modelSelect.value;
    updateReferenceControls();
  });

  viewer = createViewer(viewerEl);
  loadHistoryStore();

  els.historySearch?.addEventListener("input", () => {
    historyQuery = els.historySearch.value || "";
    renderPreviousChats();
  });

  Promise.all([cadara.meta(), cadara.settings.getKeys()]).then(([m, keys]) => {
    meta = m;
    modelsRoot = m.modelsRoot;
    let updatedCatalog = false;
    for (const [id, info] of Object.entries(m.providers || {})) {
      if (Array.isArray(info.models) && info.models.length) {
        providerCatalogs[id] = info.models;
        updatedCatalog = true;
      }
      if (Array.isArray(info.packets) && info.packets.length) providerPackets[id] = info.packets;
    }
    if (m.defaultProvider && [...els.providerSelect.options].some((o) => o.value === m.defaultProvider)) {
      els.providerSelect.value = m.defaultProvider;
    } else if (updatedCatalog) {
      // Prefer the first provider that actually has a key.
      const withKey = Object.entries(m.providers || {}).find(([, info]) => info.hasKey);
      if (withKey) els.providerSelect.value = withKey[0];
    }
    populateProviderControls(currentProvider());
    populateTextureModels(els.textureProviderSelect.value);

    const hasLocalKey = Object.values(keys).some(providerKeys => providerKeys.some(k => k.active));
    const hasEnvKey = Object.values(m.providers || {}).some(info => info.hasKey);
    hasKey = hasLocalKey || hasEnvKey;
    
    if (!hasKey) {
      addMessage("system", "Welcome! Add an API key via the ⚙ button to get started.");
    } else {
      showSuggestions();
    }
  });

  els.artifactName.addEventListener("dblclick", () => {
    if (!lastArtifact || !activeChatId) return;
    els.artifactName.contentEditable = "true";
    els.artifactName.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(els.artifactName);
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const saveArtifactName = () => {
    if (els.artifactName.contentEditable === "true") {
      els.artifactName.contentEditable = "false";
      const newName = els.artifactName.textContent.trim();
      if (!newName) {
        els.artifactName.textContent = lastArtifact?.displayName || lastArtifact?.slug || "-";
        return;
      }
      if (lastArtifact) {
        lastArtifact.displayName = newName;
      }
      if (activeChatId) {
        const chats = readPreviousChats();
        const chat = chats.find(c => c.id === activeChatId);
        if (chat && chat.artifact) {
          chat.artifact.displayName = newName;
          writePreviousChats(chats);
          renderPreviousChats();
        }
      }
    }
  };

  els.artifactName.addEventListener("blur", saveArtifactName);
  els.artifactName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      els.artifactName.blur();
    }
  });

  els.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Submit through the form so the single send path in the submit
      // listener handles validation, busy-state and clearing.
      els.promptForm.requestSubmit();
    }
  });

  els.textureProviderSelect.addEventListener("change", (e) => {
    populateTextureModels(e.target.value);
  });

  unsubEvents = cadara.chat.onEvent(handleEvent);
  els.prompt.focus();
}

function handleEvent({ type, payload, clientJobId }) {
  if (!activeClientJobId || clientJobId !== activeClientJobId) return;
  if (type === "status") setStatus(payload);
  if (type === "agent_reset") resetAgentTrace();
  if (type === "agent") updateAgentTrace(payload);
  if (type === "thought") addThoughtMessage(payload);
  if (type === "artifact") showArtifact(payload);
  if (type === "done") {
    doneReceived = true;
    setStatus("Done");
    stopPipelineTimer();
    settleRunningRows();
    setBusy(false);
    if (payload.artifacts || payload.summary) {
      lastResultInfo = { ...(lastResultInfo || {}), ...(payload.artifacts ? { artifacts: payload.artifacts } : {}), ...(payload.summary ? { summary: payload.summary } : {}) };
      if (els.detailsDrawer && !els.detailsDrawer.hidden) populateDetailsDrawer();
    }
    if (payload.summary) addMessage("assistant", payload.summary);
    if (payload.artifacts) showArtifact(payload.artifacts);
    saveCurrentChatToHistory({ artifact: payload.artifacts, summary: payload.summary || "" });
  }
}

function resetAgentTrace() {
  agentState.clear();
  stepStartTimes.clear();
  stepEndTimes.clear();
  activeAgentId = null;
  lastThinkingText = "";
  els.agentList.innerHTML = "";
  els.agentTrace.hidden = false;
  pipelineStartedAt = Date.now();

  els.traceTotalTimer.textContent = "0.0s";

  stopPipelineTimer();
  pipelineTimerInterval = setInterval(tickTimers, 100);
}

function tickTimers() {
  const now = Date.now();
  // Update total elapsed
  if (pipelineStartedAt) {
    els.traceTotalTimer.textContent = fmtElapsed(now - pipelineStartedAt);
  }
  // Update per-step elapsed for running steps
  els.agentList.querySelectorAll(".agent-row.running").forEach((row) => {
    const id = row.dataset.agentId;
    const startTime = stepStartTimes.get(id);
    if (startTime) {
      const elapsedEl = row.querySelector(".agent-elapsed");
      if (elapsedEl) elapsedEl.textContent = fmtElapsed(now - startTime);
    }
  });
}

function stopPipelineTimer() {
  if (pipelineTimerInterval) {
    clearInterval(pipelineTimerInterval);
    pipelineTimerInterval = null;
  }
}

function fmtElapsed(ms) {
  if (ms < 1000) return (ms / 1000).toFixed(1) + "s";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return mins + "m " + secs + "s";
}

const STEP_NAMES = {
  router: "Router",
  reference: "Reference",
  spec: "Spec",
  planner: "Planner",
  builder: "Builder",
  reviewer: "Reviewer",
};

function updateAgentTrace(agent) {
  if (!agent || !agent.id) return;
  els.agentTrace.hidden = false;
  const previous = agentState.get(agent.id) || {};
  const next = { ...previous, ...agent };
  agentState.set(agent.id, next);

  // Track timing
  if (next.status === "running" && !stepStartTimes.has(agent.id)) {
    stepStartTimes.set(agent.id, Date.now());
    activeAgentId = agent.id;
  }
  // A step re-entering "running" is a rate-limit retry: keep its clock going.
  if (next.status === "running") stepEndTimes.delete(agent.id);
  if (next.status === "done" || next.status === "error") {
    if (!stepEndTimes.has(agent.id)) {
      stepEndTimes.set(agent.id, Date.now());
    }
    if (activeAgentId === agent.id) activeAgentId = null;
  }

  let row = els.agentList.querySelector(`[data-agent-id="${agent.id}"]`);
  if (!row) {
    row = document.createElement("div");
    row.className = "agent-row";
    row.dataset.agentId = agent.id;
    row.innerHTML = `
      <div class="agent-dot"></div>
      <div class="agent-body">
        <div class="agent-name"></div>
        <div class="agent-detail"></div>
      </div>
      <div class="agent-meta">
        <div class="agent-elapsed">0.0s</div>
      </div>
    `;
    els.agentList.appendChild(row);
  }

  row.classList.remove("running", "done", "error");
  row.classList.add(next.status || "running");
  row.querySelector(".agent-name").textContent = STEP_NAMES[agent.id] || next.name || agent.id;
  row.querySelector(".agent-detail").textContent = next.detail || "";

  // Show final elapsed for completed steps
  if (next.status === "done" || next.status === "error") {
    const start = stepStartTimes.get(agent.id);
    const end = stepEndTimes.get(agent.id);
    if (start && end) {
      row.querySelector(".agent-elapsed").textContent = fmtElapsed(end - start);
    }
    // Remove thinking/code when done
    const thinkEl = row.querySelector(".agent-thinking");
    if (thinkEl) thinkEl.remove();
    const codeEl = row.querySelector(".agent-code-snippet");
    if (codeEl) codeEl.remove();
  }

  // Show code snippet if present (builder)
  if (next.codeSnippet && next.status === "running") {
    let codeEl = row.querySelector(".agent-code-snippet");
    if (!codeEl) {
      codeEl = document.createElement("div");
      codeEl.className = "agent-code-snippet";
      row.querySelector(".agent-body").appendChild(codeEl);
    }
    codeEl.textContent = next.codeSnippet;
  }
}

// If the run ends while a step is still marked running, settle it quietly.
function settleRunningRows() {
  els.agentList.querySelectorAll(".agent-row.running").forEach((row) => {
    row.classList.remove("running");
    row.classList.add("done");
  });
}

function setStatus(text) {
  els.iterChip.hidden = !text;
  els.iterChip.textContent = text;
}

function setBusy(value) {
  busy = value;
  els.sendBtn.disabled = value;
  els.cancelBtn.hidden = !value;
  els.referenceBtn.disabled = value || !selectedModelSupportsVision();
  els.referenceRemove.disabled = value;
  if (value) els.retryBtn.hidden = true;
  els.sendBtn.querySelector(".send-text").textContent = value ? "Designing…" : "Design";
  if (!value) {
    setStatus("");
    stopPipelineTimer();
    updateReferenceControls();
  }
}

// ---------- previous designs store ----------
// Projects live in renderer localStorage (cadara.projects.v1): every launch
// lands on the projects home and each project owns its full list of designs.
// The durable main-process store is only read once to seed the very first
// project, so nothing from older builds is lost in the switch.
let historyItems = [];
let historyReady = false;
let historyQuery = "";
let projects = [];
let activeProjectId = null;
let projectsReady = false;
let renameTargetId = null;

function projectUid() {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readProjectsFromStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => p && p.id && Array.isArray(p.items));
    }
  } catch {}
  return [];
}

function persistProjects() {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch (err) {
    // Quota or serialization trouble must never silently eat designs.
    console.warn("Cadara: could not save projects to localStorage:", err);
    addMessage("system", "⚠ Could not save projects to local storage: " + (err?.message || err), { record: false });
  }
  renderProjectsHome();
}

function projectById(id) {
  return projects.find((p) => p.id === id) || null;
}

function sortedProjects() {
  return [...projects].sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}

async function loadHistoryStore() {
  // One-time migration: pull legacy renderer-localStorage entries into
  // the durable store before switching over, then clear the old key.
  let legacy = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(parsed)) {
      legacy = parsed.filter((item) => item && item.id && !String(item.id).startsWith("mock-"));
    }
  } catch {}
  if (legacy.length && cadara.history?.importLegacy) {
    await cadara.history.importLegacy(legacy).catch(() => {});
  }
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  const seed = (await cadara.history?.list?.()) || [];
  if (!Array.isArray(seed)) historyItems.length = 0;
  initProjects(seed);
}

// Seeds the projects store. First run with existing designs: they all land in
// a single "My Designs" project so every past design stays reachable.
function initProjects(seedItems) {
  projects = readProjectsFromStorage();
  if (!projects.length && Array.isArray(seedItems) && seedItems.length) {
    const now = new Date().toISOString();
    projects = [{
      id: projectUid(),
      name: "My Designs",
      createdAt: now,
      updatedAt: now,
      items: seedItems,
    }];
    persistProjects();
  }
  historyItems = [];
  projectsReady = true;
  historyReady = true;
  renderProjectsHome();
}

function readPreviousChats() {
  return historyItems;
}

// Writes land in the active project's design list and persist to localStorage
// immediately, so the projects home always reflects the latest state.
function writePreviousChats(items) {
  const next = (items || []).filter((d) => d && d.id);
  historyItems = next;
  const project = projectById(activeProjectId);
  if (project) {
    project.items = next;
    project.updatedAt = new Date().toISOString();
    persistProjects();
  }
}

// Search matches every term against the whole design record — prompt,
// summary, name, slug, dimensions, provider, model, and date.
function historyRecordHaystack(item) {
  return [
    item.prompt,
    item.summary,
    item.artifact?.displayName,
    item.artifact?.slug,
    Array.isArray(item.artifact?.facts?.entryFacts?.size)
      ? item.artifact.facts.entryFacts.size.join(" x ")
      : "",
    item.provider,
    item.model,
    item.savedAt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function historySearchFilter(items, query) {
  const terms = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { matches: items, filtered: false };
  const matches = items.filter((item) => {
    const hay = historyRecordHaystack(item);
    // Every term must hit somewhere in the record.
    return terms.every((term) => hay.includes(term));
  });
  return { matches, filtered: true };
}

function transcriptTitle(item) {
  return item.artifact?.displayName || item.artifact?.slug || item.prompt || "Untitled design";
}

function renderPreviousChats() {
  const all = readPreviousChats();
  if (!els.historyList) return;
  els.historyList.innerHTML = "";

  const { matches: items, filtered } = historySearchFilter(all, historyQuery);

  if (all.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No previous designs yet.";
    els.historyList.appendChild(empty);
    return;
  }

  if (filtered && items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = `No designs match "${historyQuery.trim()}".`;
    els.historyList.appendChild(empty);
    return;
  }

  if (filtered) {
    const note = document.createElement("div");
    note.className = "history-match-note";
    note.textContent = `${items.length} of ${all.length} design${all.length === 1 ? "" : "s"} match`;
    els.historyList.appendChild(note);
  }
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const lastWeek = today - 7 * 86400000;

  const groups = { today: [], yesterday: [], previous7Days: [], older: [] };

  items.forEach(item => {
    const t = new Date(item.savedAt || Date.now()).getTime();
    if (t >= today) groups.today.push(item);
    else if (t >= yesterday) groups.yesterday.push(item);
    else if (t >= lastWeek) groups.previous7Days.push(item);
    else groups.older.push(item);
  });

  const createGroup = (title, groupItems) => {
    if (!groupItems.length) return;
    const label = document.createElement("div");
    label.className = "history-group";
    label.textContent = title;
    els.historyList.appendChild(label);

    groupItems.forEach(item => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-item";

      const timeStr = item.savedAt ? new Date(item.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      const titleStr = transcriptTitle(item);

      const copy = document.createElement("div");
      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = titleStr;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = [timeStr, item.provider, item.model].filter(Boolean).join(" - ");
      copy.appendChild(title);
      copy.appendChild(meta);

      const mark = document.createElement("span");
      mark.className = "history-open-mark";
      mark.textContent = ">";

      btn.appendChild(copy);
      btn.appendChild(mark);
      btn.title = [item.prompt || titleStr, item.provider, item.model].filter(Boolean).join(" - ");
      btn.addEventListener("click", () => {
        if (els.historyPopover) els.historyPopover.hidden = true;
        openPreviousChat(item);
      });
      els.historyList.appendChild(btn);
    });
  };

  createGroup("TODAY", groups.today);
  createGroup("YESTERDAY", groups.yesterday);
  createGroup("PREVIOUS 7 DAYS", groups.previous7Days);
  createGroup("OLDER", groups.older);
}

function saveCurrentChatToHistory({ artifact = lastArtifact, summary = "" } = {}) {
  if (!artifact || !lastPrompt) return;
  const item = {
    id: activeChatId || `${Date.now()}-${artifact.slug || "part"}`,
    prompt: lastPrompt,
    summary,
    artifact,
    provider: currentProvider(),
    model: els.modelSelect.value,
    transcript: currentTranscript.slice(-40),
    savedAt: new Date().toISOString(),
  };
  activeChatId = item.id;
  const existing = readPreviousChats().filter((old) => old.id !== item.id);
  writePreviousChats([item, ...existing]);
  renderPreviousChats();
}

// Rebuilds a CadSession entry from a saved history item so follow-up
// "modify" prompts keep working on reopened designs.
function entryFromHistoryItem(item) {
  const a = item.artifact || {};
  return {
    prompt: item.prompt || "",
    summary: item.summary || "",
    recordedAt: item.savedAt || new Date().toISOString(),
    slug: a.slug,
    dir: a.dir,
    sourcePath: a.sourcePath,
    pythonSource: a.pythonSource,
    facts: a.facts,
    stepPath: a.stepPath,
    glbPath: a.glbPath,
    stlPath: a.stlPath,
    viewerGlb: a.viewerGlb,
  };
}

async function openPreviousChat(item, { announce = false } = {}) {
  if (busy) return;
  clearActiveDesignView({ clearTranscript: true });
  activeChatId = item.id || null;
  currentTranscript = Array.isArray(item.transcript) ? item.transcript.slice() : [];
  lastResultInfo = {
    summary: item.summary || "",
    model: item.model || "",
    provider: item.provider || "",
    artifacts: item.artifact,
    savedAt: item.savedAt || "",
  };
  for (const msg of currentTranscript) addMessage(msg.role || "system", msg.text || "", { record: false });
  if (!currentTranscript.length) {
    addMessage("user", item.prompt || transcriptTitle(item), { record: false });
    if (item.summary) addMessage("assistant", item.summary, { record: false });
  }
  if (item.artifact) showArtifact(item.artifact);
  try {
    await cadara.session?.restore?.(entryFromHistoryItem(item));
  } catch {
    /* context restore is best-effort; the chat view still opens */
  }
  if (announce) addMessage("system", "Restored your last design session — continue where you left off.");
}

// Leaves the workbench and returns to the projects home. The current design
// is saved into the active project first, so nothing is lost.
function goHome() {
  if (busy) {
    cadara.chat.cancel();
    setBusy(false);
  }
  hideDetailsDrawer();
  saveCurrentChatToHistory();
  activeClientJobId = null;
  activeProjectId = null;
  historyItems = [];
  showProjectsHome();
}

function clearActiveDesignView({ clearTranscript = false } = {}) {
  if (clearTranscript) {
    els.chat.innerHTML = "";
    currentTranscript = [];
  }
  agentState.clear();
  stepStartTimes.clear();
  stepEndTimes.clear();
  activeAgentId = null;
  lastThinkingText = "";
  lastArtifact = null;
  lastResultInfo = null;
  hideDetailsDrawer();
  lastPrompt = "";
  lastReferenceImageForPrompt = null;
  activeClientJobId = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  activeChatId = null;
  clearReferenceImage();
  els.agentList.innerHTML = "";
  els.agentTrace.hidden = true;
  els.traceTotalTimer.textContent = "0.0s";
  stopPipelineTimer();
  resetTextureUI();
  viewer.clear();
  viewer.reset();
  els.viewerOverlay.hidden = true;
  els.viewerLoading.hidden = true;
  els.viewerEmpty.hidden = false;
  setStatus("");
  updateExportAvailability();
}

function addMessage(role, text, { record = true } = {}) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = text;
  div.appendChild(body);
  els.chat.appendChild(div);
  els.chat.scrollTop = els.chat.scrollHeight;
  if (record && text) {
    currentTranscript.push({ role, text, at: new Date().toISOString() });
    if (currentTranscript.length > 80) currentTranscript.splice(0, currentTranscript.length - 80);
  }
}

function addThoughtMessage(text) {
  lastThinkingText = text;

  // Show inline under the active agent step
  if (activeAgentId) {
    const row = els.agentList.querySelector(`[data-agent-id="${activeAgentId}"]`);
    if (row) {
      let thinkEl = row.querySelector(".agent-thinking");
      if (!thinkEl) {
        thinkEl = document.createElement("div");
        thinkEl.className = "agent-thinking";
        row.querySelector(".agent-body").appendChild(thinkEl);
      }
      // Show the last ~120 chars of thinking
      thinkEl.textContent = text.length > 120 ? "…" + text.slice(-120) : text;
    }
  }

  // Also add condensed version to chat
  const div = document.createElement("div");
  div.className = "msg system";

  const header = document.createElement("div");
  header.className = "thought-header";
  header.textContent = "💭 Thinking";

  const body = document.createElement("div");
  body.className = "thought-body";
  body.textContent = text.length > 200 ? text.slice(0, 200) + "…" : text;

  div.appendChild(header);
  div.appendChild(body);
  els.chat.appendChild(div);
  els.chat.scrollTop = els.chat.scrollHeight;
}

function showArtifact(artifact) {
  lastArtifact = artifact;
  updateExportAvailability();
  els.viewerEmpty.hidden = true;
  els.viewerLoading.hidden = false;
  els.viewerLoadingText.textContent = "Rendering " + artifact.slug + " ...";

  const relGlb = artifact.slug + "/.part.step.glb";
  const url = "cadarafile://local" + encodeURI(modelsRoot + "/" + relGlb);

  viewer
    .load(url)
    .then(({ sourceSizeMm }) => {
      els.viewerLoading.hidden = true;
      els.viewerOverlay.hidden = false;
      els.artifactName.textContent = artifact.displayName || artifact.slug;
      els.artifactDims.textContent = dimsFromFacts(artifact.facts) || fmtSize(sourceSizeMm) + " mm";
      setupTextureForArtifact(artifact);
    })
    .catch((err) => {
      els.viewerLoading.hidden = true;
      els.viewerOverlay.hidden = false;
      els.artifactName.textContent = artifact.displayName || artifact.slug;
      els.artifactDims.textContent = "3D preview unavailable (" + (err.message || "load error") + ")";
      setupTextureForArtifact(artifact);
    });
}

function fmtSize(v) {
  if (!v) return "";
  return [v.x, v.y, v.z]
    .map((n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""))
    .join(" × ");
}

function dimsFromFacts(facts) {
  if (!facts) return "";
  const parts = [];
  const size = facts.entryFacts?.size;
  if (size) parts.push("size " + size.map((n) => +n.toFixed(2)).join(" × ") + " mm");
  if (facts.faceCount != null) parts.push(facts.faceCount + " faces");
  if (facts.bounds) {
    const [min, max] = [facts.bounds.min, facts.bounds.max];
    parts.push(
      "bounds [" + min.map((n) => +n.toFixed(2)).join(", ") + "] → [" + max.map((n) => +n.toFixed(2)).join(", ") + "]"
    );
  }
  return parts.join("  ·  ");
}

// -----------------------------------------------------------------------------
// Texture: the canvas offers a texture pass once a part exists. The
// description goes back to the selected engine as a secondary, premade
// prompt and the returned material spec is applied to the finished part.
// -----------------------------------------------------------------------------

let textureBusy = false;

function setTextureStatus(text, isError = false) {
  els.textureStatus.textContent = text || "";
  els.textureStatus.classList.toggle("err", Boolean(text) && isError);
}

function resetTextureUI() {
  viewer?.clearTexture?.();
  els.texturePanel.hidden = true;
  els.textureTab.hidden = true;
  els.textureInput.value = "";
  setTextureStatus("");
  els.textureRemove.hidden = true;
}

// Called each time an artifact finishes loading. A fresh part re-opens the
// offer; a part reopened from history restores its saved texture.
function setupTextureForArtifact(artifact) {
  viewer?.clearTexture?.();
  els.textureRemove.hidden = true;
  setTextureStatus("");
  if (artifact.textureSpec) {
    els.textureInput.value = artifact.textureSpec.request || "";
    const applied = viewer?.applyTexture?.(artifact.textureSpec);
    if (applied?.ok) {
      els.textureRemove.hidden = false;
      setTextureStatus(artifact.textureSpec.notes || "Saved texture restored.");
    }
  }
  els.textureTab.hidden = false;
  els.texturePanel.hidden = false;
  if (!artifact.textureSpec) els.textureInput.focus();
}

function persistTextureSpec(spec) {
  if (!lastArtifact) return;
  if (spec) lastArtifact.textureSpec = spec;
  else delete lastArtifact.textureSpec;
  if (!activeChatId) return;
  const chats = readPreviousChats();
  const chat = chats.find((c) => c.id === activeChatId);
  if (chat && chat.artifact) {
    if (spec) chat.artifact.textureSpec = spec;
    else delete chat.artifact.textureSpec;
    writePreviousChats(chats);
  }
}

async function requestTexture() {
  if (textureBusy) return;
  const description = els.textureInput.value.trim();
  if (!lastArtifact) {
    setTextureStatus("Generate a part first — texture is applied to the finished model.", true);
    return;
  }
  if (!description) {
    setTextureStatus("Describe the texture you want first.", true);
    return;
  }

  textureBusy = true;
  els.textureOk.disabled = true;
  els.textureOk.textContent = "Applying…";
  setTextureStatus("Sending the texture brief to the engine…");
  try {
    const res = await cadara.texture.generate(description, els.textureProviderSelect.value, els.textureModelSelect.value, {
      slug: lastArtifact.slug,
      displayName: lastArtifact.displayName || lastArtifact.slug,
      facts: lastArtifact.facts || null,
    });
    if (!res || !res.ok) {
      setTextureStatus((res && res.error) || "The texture request failed.", true);
      return;
    }
    const applied = viewer.applyTexture(res.spec);
    if (!applied.ok) {
      setTextureStatus(applied.error || "Could not apply the texture to the part.", true);
      return;
    }
    persistTextureSpec(res.spec);
    els.textureRemove.hidden = false;
    setTextureStatus(res.spec.notes || "Texture applied.");
    addMessage("system", "Texture applied to " + lastArtifact.slug + " — " + (res.spec.notes || description));
  } catch (err) {
    setTextureStatus((err && err.message) || String(err), true);
  } finally {
    textureBusy = false;
    els.textureOk.disabled = false;
    els.textureOk.textContent = "OK";
  }
}

// Browser-preview fallback (no Electron bridge): derive a spec locally so the
// flow is still walkable. The real app always uses the engine.
function localTextureSpec(description) {
  const text = (description || "").toLowerCase();
  const spec = {
    name: "local finish",
    baseColor: "#9aa0a8",
    metalness: 0.1,
    roughness: 0.55,
    pattern: "none",
    patternScale: 1,
    bumpStrength: 0.5,
    finish: "satin",
    notes: "Preview-mode local finish (no engine connected).",
    request: description,
  };
  if (/steel|iron|chrome| polished/.test(text)) { spec.baseColor = "#c9ccd1"; spec.metalness = 0.95; spec.roughness = /polished|chrome/.test(text) ? 0.15 : 0.35; spec.finish = /polished|chrome/.test(text) ? "glossy" : "satin"; }
  if (/alumin|alumin?ium|aluminum|brushed/.test(text)) { spec.baseColor = "#b8bcc2"; spec.metalness = 0.9; spec.roughness = 0.32; spec.pattern = "brushed"; spec.name = "brushed aluminium"; }
  if (/brass|gold|copper|bronze/.test(text)) { spec.baseColor = /copper|bronze/.test(text) ? "#b87348" : "#cfa64b"; spec.metalness = 0.9; spec.roughness = 0.3; }
  if (/black|carbon/.test(text)) { spec.baseColor = "#26282c"; spec.metalness = 0.2; spec.roughness = 0.6; if (/carbon/.test(text)) { spec.pattern = "carbon"; spec.name = "carbon fiber"; } }
  if (/wood|walnut|oak|grain/.test(text)) { spec.baseColor = "#8a5f38"; spec.metalness = 0; spec.roughness = 0.7; spec.pattern = "wood"; spec.name = "wood grain"; }
  if (/rubber|soft|silicone/.test(text)) { spec.baseColor = "#2c2c2e"; spec.metalness = 0; spec.roughness = 0.95; spec.finish = "matte"; spec.name = "matte rubber"; }
  if (/knurl/.test(text)) { spec.pattern = "knurl"; spec.bumpStrength = 0.85; spec.name = "knurled"; }
  if (/leather/.test(text)) { spec.baseColor = "#5d4033"; spec.metalness = 0; spec.roughness = 0.8; spec.pattern = "leather"; spec.name = "leather"; }
  if (/hammer/.test(text)) { spec.pattern = "hammered"; spec.metalness = 0.85; spec.name = "hammered"; }
  return spec;
}

els.textureOk.addEventListener("click", requestTexture);

els.textureInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    requestTexture();
  }
});

els.textureClose.addEventListener("click", () => {
  // Hide into the side bar; the Texture tab stays on the canvas to reopen it.
  els.texturePanel.hidden = true;
});

els.textureTab.addEventListener("click", () => {
  els.texturePanel.hidden = false;
  els.textureInput.focus();
});

els.textureRemove.addEventListener("click", () => {
  viewer?.clearTexture?.();
  persistTextureSpec(null);
  els.textureRemove.hidden = true;
  setTextureStatus("Texture removed — back to the raw material.");
});



function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
}

function updateReferenceControls() {
  if (!els.referenceBtn) return;
  const supportsVision = selectedModelSupportsVision();
  els.referenceBtn.disabled = busy || !supportsVision;
  els.referenceUploader.classList.toggle("disabled", !supportsVision);
  if (!supportsVision && referenceImage) clearReferenceImage();
}

function clearReferenceImage() {
  referenceImage = null;
  els.referenceInput.value = "";
  els.referencePreview.hidden = true;
  els.referenceThumb.src = EMPTY_IMAGE_SRC;
  els.referenceName.textContent = "";
  els.referenceNote.textContent = "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

async function chooseReferenceImage(file) {
  if (!file) return;
  if (!selectedModelSupportsVision()) {
    addMessage("system", "Pick a model that supports image input before attaching a reference.", { record: false });
    return;
  }
  if (!IMAGE_MIME_TYPES.has(file.type)) {
    addMessage("system", "Reference image must be PNG, JPEG, or WebP.", { record: false });
    return;
  }
  if (file.size > MAX_REFERENCE_BYTES) {
    addMessage("system", "Reference image is too large. Use an image under 10 MB.", { record: false });
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  referenceImage = {
    name: file.name || "reference image",
    mimeType: file.type,
    size: file.size,
    dataUrl,
  };
  els.referenceThumb.src = dataUrl;
  els.referenceName.textContent = referenceImage.name;
  els.referenceNote.textContent = `${file.type.replace("image/", "").toUpperCase()} - ${formatBytes(file.size)}`;
  els.referencePreview.hidden = false;
}

async function send(prompt, isAutoRetry = false) {
  if (isAutoRetry && !activeClientJobId) return;
  if (!isAutoRetry) autoRetryCount = 0;
  // Attach active tune constraints to the design prompt. On auto-retry the
  // prompt is already the constrained form (lastPrompt), so we don't append again.
  const fullPrompt = isAutoRetry ? prompt : prompt + collectTuneConstraints();
  lastPrompt = fullPrompt;
  const clientJobId = isAutoRetry && activeClientJobId ? activeClientJobId : `job-${Date.now()}-${++runSerial}`;
  activeClientJobId = clientJobId;
  setBusy(true);
  doneReceived = false;
  const referenceForSend = isAutoRetry ? lastReferenceImageForPrompt : (referenceImage ? { ...referenceImage } : null);
  if (!isAutoRetry) lastReferenceImageForPrompt = referenceForSend;
  if (!isAutoRetry) {
    addMessage("user", referenceForSend ? `${fullPrompt}\n\nReference image: ${referenceForSend.name}` : fullPrompt);
  }
  setTuneLocked(true);
  hideSuggestions();
  setStatus("Starting…");
  const model = els.modelSelect.value;
  const maxRetries = 2;
  try {
    const res = await cadara.chat.send(fullPrompt, currentProvider(), model, referenceForSend, clientJobId);
    if (clientJobId !== activeClientJobId) return;
    if (!res.ok) {
      addMessage("system", res.canceled ? "Canceled." : "⚠ " + res.error);
      if (res.canceled) {
        setStatus("Canceled");
        stopPipelineTimer();
        settleRunningRows();
      } else {
        setStatus("Failed");
        els.retryBtn.hidden = false;
        markPipelineError();
      }
      return;
    }
    if (res.ok && res.result) {
      lastResultInfo = res.result;
      if (!els.detailsDrawer.hidden) populateDetailsDrawer();
    }
    if (!doneReceived) {
      doneReceived = true;
      setStatus("Done");
      stopPipelineTimer();
      settleRunningRows();
      if (res.result?.summary) addMessage("assistant", res.result.summary);
      if (res.result?.artifacts) showArtifact(res.result.artifacts);
      if (res.result?.artifacts) {
        saveCurrentChatToHistory({ artifact: res.result.artifacts, summary: res.result.summary || "" });
      }
    }
  } catch (err) {
    if (clientJobId !== activeClientJobId) return;
    const errorMsg = err && err.message ? err.message : String(err);
    addMessage("system", "⚠ " + errorMsg);
    setStatus("Failed");
    els.retryBtn.hidden = false;
    markPipelineError();
  } finally {
    if (clientJobId === activeClientJobId) {
      setBusy(false);
      setTuneLocked(false);
    }
  }
}

function markPipelineError() {
  // Flag the step that was running when the run failed.
  const runningRow = els.agentList.querySelector(".agent-row.running");
  if (runningRow) {
    runningRow.classList.remove("running");
    runningRow.classList.add("error");
  }
}

els.promptForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.prompt.value.trim();
  if (!text || busy) return;
  els.prompt.value = "";
  send(text);
});

els.cancelBtn.addEventListener("click", () => {
  cadara.chat.cancel();
  addMessage("system", "Canceling…");
});

// -- Tune panel (design constraint sliders) wiring ---------------------------------
// The tune panel is a set of sliders that constrain the next generation(s). The
// sliders start out inert ("any"); moving one marks it as "touched", which
// flips its label to the active value and appends a constraint block to the
// next design prompt. Reset clears the touched set and restores defaults.

// Default slider values are authored in index.html; read them from the DOM so
// this stays in sync with what the markup declares.
const TUNE_DEFAULTS = {};
els.tuneSliders.forEach((s) => (TUNE_DEFAULTS[s.id] = Number(s.value)));
const touchedTunes = new Set();

// Reflects slider state into the [data-value-for] label spans (value or "any").
function updateTuneLabels() {
  els.tuneSliders.forEach((s) => {
    const label = document.querySelector(`.tune-value[data-value-for="${s.id}"]`);
    if (!label) return;
    label.textContent = touchedTunes.has(s.id) ? formatTuneValue(s.id, s.value) : "any";
  });
}

function formatTuneValue(id, raw) {
  const v = Number(raw);
  if (id === "tune-size") return `${v} mm`;
  if (id === "tune-wall") return `${v} mm`;
  if (id === "tune-round" || id === "tune-detail" || id === "tune-fit") return `${v}%`;
  return String(v);
}

// Builds the constraint suffix appended to the design prompt. Empty when no
// slider has been touched, so a pristine tune panel never alters a prompt.
function collectTuneConstraints() {
  if (touchedTunes.size === 0) return "";
  const rows = [];
  els.tuneSliders.forEach((s) => {
    if (touchedTunes.has(s.id)) {
      const name = {
        "tune-size": "overall size",
        "tune-wall": "wall thickness",
        "tune-round": "corner rounding",
        "tune-detail": "detail level",
        "tune-fit": "fit tolerance",
      }[s.id] || s.id;
      rows.push(`- ${name}: ${formatTuneValue(s.id, s.value)}`);
    }
  });
  return (
    "\n\n**Tune the constraints** for this design (apply unless the request says otherwise):\n" +
    rows.join("\n")
  );
}

els.tuneSliders.forEach((s) => {
  s.addEventListener("input", () => {
    touchedTunes.add(s.id);
    updateTuneLabels();
  });
});

els.tuneBtn?.addEventListener("click", () => {
  const isOpen = !els.tunePanel.hidden;
  els.tunePanel.hidden = isOpen;
  updateTuneLabels();
});

els.tuneResetBtn?.addEventListener("click", () => {
  els.tuneSliders.forEach((s) => {
    s.value = TUNE_DEFAULTS[s.id];
    touchedTunes.delete(s.id);
  });
  updateTuneLabels();
});

// Keep the sliders locked while a generation is running (see setBusy).
function setTuneLocked(locked) {
  if (!els.tuneSliders.length) return;
  els.tuneSliders.forEach((s) => (s.disabled = locked));
  if (els.tuneResetBtn) els.tuneResetBtn.disabled = locked;
  updateTuneLabels();
}


els.retryBtn.addEventListener("click", () => {
  if (lastPrompt && !busy) {
    send(lastPrompt);
  }
});

els.resetView.addEventListener("click", () => viewer.reset());

els.referenceBtn.addEventListener("click", () => {
  if (!busy && selectedModelSupportsVision()) els.referenceInput.click();
});

els.referenceInput.addEventListener("change", () => {
  chooseReferenceImage(els.referenceInput.files?.[0]).catch((err) => {
    addMessage("system", "Could not read reference image: " + (err.message || err), { record: false });
    clearReferenceImage();
  });
});

els.referenceRemove.addEventListener("click", clearReferenceImage);

els.newChatBtn.addEventListener("click", async () => {
  if (busy) cadara.chat.cancel();
  saveCurrentChatToHistory();
  activeClientJobId = null;
  setBusy(false);
  await cadara.session.clear();
  clearActiveDesignView({ clearTranscript: true });
  if (hasKey) showSuggestions();
  els.prompt.focus();
});

els.historyBtn.addEventListener("click", () => {
  setRailActive("history-btn");
  renderPreviousChats();
  els.historyPopover.hidden = !els.historyPopover.hidden;
});

els.historyClearBtn.addEventListener("click", () => {
  // Wipe the active project's designs (and any legacy localStorage leftovers).
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  writePreviousChats([]);
  renderPreviousChats();
});

document.addEventListener("click", (e) => {
  if (
    els.historyPopover.hidden ||
    els.historyPopover.contains(e.target) ||
    els.historyBtn.contains(e.target)
  ) {
    return;
  }
  els.historyPopover.hidden = true;
});

let lastActiveTab = "panel-keys";

els.settingsBtn.addEventListener("click", async () => {
  els.modal.hidden = false;
  els.skillsNote.textContent = "";
  
  await renderProviderKeys();
  await loadSkills();

  // Restore last active tab
  els.settingsNavBtns.forEach(t => t.classList.remove("active"));
  els.settingsPanels.forEach(p => { p.classList.remove("active"); p.hidden = true; });
  const tabToActivate = Array.from(els.settingsNavBtns).find(t => t.dataset.target === lastActiveTab) || els.settingsNavBtns[0];
  if (tabToActivate) {
    tabToActivate.classList.add("active");
    els.settingsContentTitle.textContent = tabToActivate.textContent;
    const target = document.getElementById(tabToActivate.dataset.target);
    if (target) {
      target.classList.add("active");
      target.hidden = false;
    }
    if (tabToActivate.dataset.target === "panel-local") renderLocalPanel();
  }
});

// Tab switching
els.settingsNavBtns.forEach(tab => {
  tab.addEventListener("click", () => {
    lastActiveTab = tab.dataset.target;
    els.settingsNavBtns.forEach(t => t.classList.remove("active"));
    els.settingsPanels.forEach(p => { p.classList.remove("active"); p.hidden = true; });
    tab.classList.add("active");
    els.settingsContentTitle.textContent = tab.textContent;
    const target = document.getElementById(tab.dataset.target);
    if (target) {
      target.classList.add("active");
      target.hidden = false;
    }
    if (tab.dataset.target === "panel-local") renderLocalPanel();
  });
});

async function renderProviderKeys() {
  const keys = await cadara.settings.getKeys();
  els.providerSections.innerHTML = "";
  
  const providerConfig = [
    { id: "gemini", label: "Gemini", desc: "Recommended for highest CAD reasoning quality." },
    { id: "claude", label: "Claude", desc: "Excellent alternative for planning and logic." },
    { id: "openai", label: "OpenAI", desc: "Solid performance on standard design tasks." },
    { id: "zai", label: "Z.AI", desc: "GLM models — strong tool calling, great value." },
    { id: "qwen", label: "Qwen", desc: "Alibaba DashScope models for text-only CAD generation." },
    { id: "openrouter", label: "OpenRouter", desc: "Access to various models via one API." }
  ];

  for (const provider of providerConfig) {
    const providerKeys = keys[provider.id] || [];
    const section = document.createElement("div");
    section.className = "provider-section";
    
    let keysHtml = "";
    if (providerKeys.length === 0) {
      keysHtml = `<div class="settings-note">No keys configured for ${provider.label}.</div>`;
    } else {
      keysHtml = `<div class="key-list">` + providerKeys.map(k => `
        <div class="key-card ${k.active ? 'active-key' : ''}">
          <div class="key-info">
            <span class="key-label">${escapeHtml(k.label)}</span>
            <span class="key-value">${escapeHtml(k.key)}</span>
          </div>
          <div class="key-actions">
            <button type="button" class="enable-btn ${k.active ? 'is-active' : ''}" data-id="${k.id}" data-provider="${provider.id}">
              ${k.active ? 'Active' : 'Enable'}
            </button>
            <button type="button" class="delete-key-btn" data-id="${k.id}" data-provider="${provider.id}" title="Remove Key">
              <svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `).join('') + `</div>`;
    }

    section.innerHTML = `
      <div class="provider-header">
        <div>
          <h3>${provider.label} ${provider.id === 'gemini' ? '⭐ Recommended' : ''}</h3>
        </div>
        <button type="button" class="add-key-btn" data-provider="${provider.id}">+ Add Key</button>
      </div>
      <p class="panel-desc" style="margin-top:-8px; margin-bottom: 0;">${provider.desc}</p>
      ${keysHtml}
    `;
    els.providerSections.appendChild(section);
  }
  
  // Attach events
  els.providerSections.querySelectorAll(".add-key-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const provider = btn.dataset.provider;
      const providerName = providerConfig.find(p => p.id === provider)?.label || provider;
      els.addKeyProvider.value = provider;
      els.addKeyTitle.textContent = `Add API Key for ${providerName}`;
      els.addKeyLabel.value = "";
      els.addKeyValue.value = "";
      els.addKeyDialog.hidden = false;
      els.addKeyLabel.focus();
    });
  });
  
  els.providerSections.querySelectorAll(".enable-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.classList.contains("is-active")) return;
      await cadara.settings.toggleKey({ provider: btn.dataset.provider, id: btn.dataset.id });
      await renderProviderKeys();
      checkGlobalKeyStatus();
    });
  });
  
  els.providerSections.querySelectorAll(".delete-key-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to remove this key?")) return;
      await cadara.settings.removeKey({ provider: btn.dataset.provider, id: btn.dataset.id });
      await renderProviderKeys();
      checkGlobalKeyStatus();
    });
  });
}

async function checkGlobalKeyStatus() {
  const keys = await cadara.settings.getKeys();
  hasKey = Object.values(keys).some(providerKeys => providerKeys.some(k => k.active));
  
  // Refresh meta and models
  cadara.meta().then((m) => {
    meta = m;
    for (const [id, info] of Object.entries(m.providers || {})) {
      if (Array.isArray(info.models) && info.models.length) providerCatalogs[id] = info.models;
      if (Array.isArray(info.packets) && info.packets.length) providerPackets[id] = info.packets;
    }
    populateProviderControls(currentProvider());
  });
}

// Add Key Form Logic
els.addKeyCancel?.addEventListener("click", () => {
  els.addKeyDialog.hidden = true;
});

els.addKeyForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const provider = els.addKeyProvider.value;
  const label = els.addKeyLabel.value.trim();
  const key = els.addKeyValue.value.trim();
  
  if (!key || !label || !provider) return;
  
  await cadara.settings.addKey({ provider, label, key });
  els.addKeyDialog.hidden = true;
  await renderProviderKeys();
  checkGlobalKeyStatus();
});

// Skills CRUD
async function loadSkills() {
  const skills = await cadara.skills.list();
  els.skillsList.innerHTML = "";
  const emptyEl = document.getElementById("skills-empty");
  if (emptyEl) emptyEl.hidden = skills.length > 0;
  
  skills.forEach(skill => {
    const card = document.createElement("div");
    card.className = "skill-card";
    card.innerHTML = `
      <div class="skill-info">
        <h4>${escapeHtml(skill.name)}</h4>
        <p title="${escapeHtml(skill.body)}">${escapeHtml(skill.body)}</p>
      </div>
      <div class="skill-actions">
        <div class="skill-toggle ${skill.active ? 'active' : ''}" data-id="${skill.id}"></div>
        <button type="button" class="delete-skill-btn" data-id="${skill.id}" title="Delete skill">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    
    card.querySelector(".skill-toggle").addEventListener("click", async (e) => {
      const isCurrentlyActive = e.target.classList.contains("active");
      if (!isCurrentlyActive) {
        const activeCount = Array.from(document.querySelectorAll(".skill-toggle.active")).length;
        if (activeCount >= 2) {
          els.skillsNote.textContent = "Maximum 2 active skills allowed.";
          els.skillsNote.className = "settings-note err";
          return;
        }
      }
      
      const newActive = !isCurrentlyActive;
      const res = await cadara.skills.save({ ...skill, active: newActive });
      if (res.ok) {
        e.target.classList.toggle("active", newActive);
        els.skillsNote.textContent = "";
      } else {
        els.skillsNote.textContent = res.error;
        els.skillsNote.className = "settings-note err";
      }
    });

    card.querySelector(".delete-skill-btn").addEventListener("click", async () => {
      const res = await cadara.skills.delete(skill.id);
      if (res.ok) await loadSkills();
    });

    els.skillsList.appendChild(card);
  });
}

function escapeHtml(unsafe) {
  return (unsafe || "").replace(/[&<"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '"': return '&quot;';
      default: return '&#039;';
    }
  });
}

els.createSkillBtn.addEventListener("click", () => {
  els.skillForm.hidden = false;
  els.createSkillBtn.hidden = true;
  els.skillName.focus();
});

els.skillCancelBtn.addEventListener("click", () => {
  els.skillForm.hidden = true;
  els.createSkillBtn.hidden = false;
  els.skillForm.reset();
});

els.skillForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = els.skillName.value.trim();
  const body = els.skillBody.value.trim();
  if (!name || !body) return;

  const res = await cadara.skills.save({
    id: 'skill_' + Date.now(),
    name,
    body,
    active: false,
  });

  if (res.ok) {
    els.skillForm.hidden = true;
    els.createSkillBtn.hidden = false;
    els.skillForm.reset();
    els.skillsNote.textContent = "Skill saved.";
    els.skillsNote.className = "settings-note ok";
    await loadSkills();
  } else {
    els.skillsNote.textContent = res.error;
    els.skillsNote.className = "settings-note err";
  }
});

// -----------------------------------------------------------------------------
// Local Models (Ollama)
// Download curated CAD-capable models once, then run fully offline: pick
// "Ollama (Local)" in the AI dropdown and only downloaded models appear.
// -----------------------------------------------------------------------------

const OLLAMA_RECOMMENDED = [
  {
    model: "qwen2.5-coder:7b",
    label: "Local Fast — Qwen2.5-Coder 7B",
    size: "≈4.7 GB download",
    desc: "Quick local CAD for simple parts, plates, holes, and brackets. Needs ~8 GB RAM.",
  },
  {
    model: "qwen2.5-coder:14b",
    label: "Local Balanced — Qwen2.5-Coder 14B",
    size: "≈9 GB download",
    desc: "Noticeably better geometry code and fewer repair loops. Needs ~16 GB RAM.",
  },
  {
    model: "qwen3-coder:30b",
    label: "Local Max — Qwen3-Coder 30B",
    size: "≈19 GB download",
    desc: "Best local CAD quality (MoE — runs at 8B-like speed). Needs ~24-32 GB RAM.",
  },
];

const ollamaPulls = new Map(); // model -> { percent, status, done, error }
let ollamaPanelLoading = false;
let ollamaRenderQueued = false;

function ollamaBaseName(name) {
  return String(name || "").replace(/:latest$/i, "");
}

function formatModelSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return "";
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(1).replace(/\.0$/, "") + " GB";
  return Math.round(n / (1024 * 1024)) + " MB";
}

function setLocalNote(text, isError = false) {
  els.ollamaLocalNote.hidden = !text;
  els.ollamaLocalNote.textContent = text || "";
  els.ollamaLocalNote.className = "settings-note" + (text && isError ? " err" : "");
}

function renderOllamaStatus(status) {
  const up = Boolean(status?.reachable);
  els.ollamaStatusDot.classList.toggle("up", up);
  els.ollamaStatusDot.classList.toggle("down", !up);
  els.ollamaStatusText.textContent = up
    ? `Ollama is running (${String(status.url || "").replace(/^https?:\/\//, "")})`
    : "Ollama not detected on this machine";
  els.ollamaInstallLink.hidden = up;
  return { up, models: Array.isArray(status?.models) ? status.models : [] };
}

function ollamaRowHtml({ title, subtitle, desc, sideHtml, extraHtml = "" }) {
  return `
    <div class="ollama-model-info">
      <div class="ollama-model-head">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="ollama-model-sub">${escapeHtml(subtitle)}</div>` : ""}
      ${desc ? `<div class="ollama-model-desc">${escapeHtml(desc)}</div>` : ""}
      ${extraHtml}
    </div>
    <div class="ollama-model-side">${sideHtml}</div>`;
}

async function renderLocalPanel() {
  if (ollamaPanelLoading) return;
  ollamaPanelLoading = true;
  els.ollamaStatusText.textContent = "Checking for Ollama…";
  els.ollamaRecommended.innerHTML = "";
  els.ollamaInstalled.innerHTML = "";
  let status = null;
  try {
    status = await cadara.ollama.status();
  } catch {
    status = { reachable: false, models: [] };
  }
  const { up, models } = renderOllamaStatus(status);
  const installedNames = new Set(models.map((m) => ollamaBaseName(m.name)));

  // Recommended presets with one-click downloads.
  for (const preset of OLLAMA_RECOMMENDED) {
    const installed = up && installedNames.has(ollamaBaseName(preset.model));
    const pull = ollamaPulls.get(preset.model);
    const running = Boolean(pull && !pull.done);
    const err = pull?.done && pull?.error;
    let extraHtml = "";
    let sideHtml;
    if (running) {
      const pct = pull.percent;
      extraHtml = `
        <div class="ollama-progress">
          <div class="ollama-progress-bar"><div class="ollama-progress-fill" style="transform: scaleX(${Math.max(0.02, (pct ?? 0) / 100)})"></div></div>
          <span class="ollama-progress-text">${pct != null ? pct + "%" : escapeHtml(pull.status || "Starting…")}</span>
        </div>`;
      sideHtml = `<span class="ollama-installed-chip downloading">Downloading…</span>`;
    } else if (err) {
      extraHtml = `<div class="settings-note err">${escapeHtml(err)}</div>`;
      sideHtml = `<button type="button" class="ollama-download-btn" data-model="${escapeHtml(preset.model)}" ${up ? "" : "disabled"}>Retry download</button>`;
    } else if (installed) {
      sideHtml = `<span class="ollama-installed-chip">Installed</span>`;
    } else {
      sideHtml = `<button type="button" class="ollama-download-btn" data-model="${escapeHtml(preset.model)}" ${up ? "" : "disabled"}>Download</button>`;
    }
    const row = document.createElement("div");
    row.className = "ollama-model-row";
    row.innerHTML = ollamaRowHtml({
      title: preset.label,
      subtitle: preset.size,
      desc: preset.desc,
      sideHtml,
      extraHtml,
    });
    els.ollamaRecommended.appendChild(row);
  }

  wireOllamaRecommendedButtons();
  renderOllamaInstalledList(up, models);
  ollamaPanelLoading = false;
}

function wireOllamaRecommendedButtons() {
  els.ollamaRecommended.querySelectorAll(".ollama-download-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const model = btn.dataset.model;
      ollamaPulls.set(model, { percent: null, status: "Starting…", done: false });
      setLocalNote("");
      const res = await cadara.ollama.pull(model);
      if (!res?.ok) {
        ollamaPulls.delete(model);
        setLocalNote(res?.error || "Could not start the download.", true);
        renderLocalPanel();
      } else {
        renderLocalPanel();
      }
    });
  });
}

function renderOllamaInstalledList(up, models) {
  // Everything downloaded on this machine — these are exactly the models the
  // AI dropdown offers when "Ollama (Local)" is selected.
  if (!up) {
    els.ollamaInstalled.innerHTML = `<div class="ollama-empty">Start Ollama and refresh — downloaded models will be listed here and appear in the AI dropdown.</div>`;
    return;
  }
  if (models.length === 0) {
    els.ollamaInstalled.innerHTML = `<div class="ollama-empty">No models downloaded yet. Grab one of the recommended models above.</div>`;
    return;
  }
  els.ollamaInstalled.innerHTML = "";
  for (const m of models) {
    const row = document.createElement("div");
    row.className = "ollama-model-row";
    const size = formatModelSize(m.size);
    row.innerHTML = ollamaRowHtml({
      title: ollamaBaseName(m.name),
      subtitle: size ? `${size} on disk` : "",
      desc: "",
      sideHtml: `<button type="button" class="ollama-use-btn" data-model="${escapeHtml(m.name)}">Use</button>`,
    });
    els.ollamaInstalled.appendChild(row);
  }
  els.ollamaInstalled.querySelectorAll(".ollama-use-btn").forEach((btn) => {
    btn.addEventListener("click", () => useOllamaModel(btn.dataset.model));
  });
}

// Switch the composer to Ollama with this exact downloaded model selected.
function useOllamaModel(modelName) {
  els.providerSelect.value = "ollama";
  populateProviderControls("ollama");
  if (![...els.modelSelect.options].some((o) => o.value === modelName)) {
    const opt = document.createElement("option");
    opt.value = modelName;
    opt.textContent = compactModelLabel("ollama", modelName);
    els.modelSelect.appendChild(opt);
  }
  els.modelSelect.value = modelName;
  selectedModelByProvider.ollama = modelName;
  updateReferenceControls();
  els.modal.hidden = true;
  els.prompt.focus();
  addMessage("system", `Local model ready: ${modelName} (Ollama). Design runs stay on this machine.`, { record: false });
}

function handleOllamaPullProgress(evt) {
  const pull = ollamaPulls.get(evt.model);
  if (!pull) return;
  pull.percent = evt.percent ?? pull.percent;
  pull.status = evt.status || pull.status;
  if (evt.done) {
    pull.done = true;
    pull.error = evt.error || null;
    if (!evt.error) {
      ollamaPulls.delete(evt.model);
      setLocalNote(`${ollamaBaseName(evt.model)} downloaded — pick it in the AI dropdown (Ollama (Local)).`);
      // Refresh the composer catalog so the new model shows up immediately.
      checkGlobalKeyStatus();
    }
  }
  // Progress events arrive many times a second; throttle panel re-renders.
  if (ollamaRenderQueued) return;
  ollamaRenderQueued = true;
  setTimeout(() => {
    ollamaRenderQueued = false;
    renderLocalPanel();
  }, 400);
}

cadara.ollama?.onPullProgress?.(handleOllamaPullProgress);
els.ollamaRefreshBtn?.addEventListener("click", () => {
  setLocalNote("");
  renderLocalPanel();
});

els.settingsClose.addEventListener("click", () => (els.modal.hidden = true));

els.helpBtn.addEventListener("click", () => {
  els.helpModal.hidden = false;
  els.helpClose.focus();
});

els.helpClose.addEventListener("click", () => (els.helpModal.hidden = true));

els.modal.addEventListener("click", (e) => {
  if (e.target === els.modal) els.modal.hidden = true;
});

els.helpModal.addEventListener("click", (e) => {
  if (e.target === els.helpModal) els.helpModal.hidden = true;
});

// Removing old testKey and submit listeners, everything handled by new provider keys UI

function showSuggestions() {
  els.suggestions.hidden = false;
  els.suggestions.innerHTML = "";
  EXAMPLE_PROMPTS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggestion-btn";
    b.textContent = p;
    b.addEventListener("click", () => {
      els.prompt.value = p;
      els.prompt.focus();
    });
    els.suggestions.appendChild(b);
  });
}

function hideSuggestions() {
  els.suggestions.hidden = true;
}

// Disables/enables the toolbar Export button and keeps its tooltip honest
// based on whether a part is currently loaded. Called whenever artifact state
// changes, so the button never silently does nothing.
function updateExportAvailability() {
  const available = Boolean(lastArtifact && lastArtifact.slug);
  if (els.exportBtn) {
    els.exportBtn.disabled = !available;
    els.exportBtn.title = available ? "Export the current model" : "Generate a design first, then export";
  }
}

els.exportBtn?.addEventListener("click", () => {
  if (!lastArtifact || !lastArtifact.slug) {
    if (els.progressStatus) {
      els.exportPopup.hidden = false;
      els.exportProgress.hidden = true;
      els.progressStatus.textContent = "No part is loaded to export. Generate a design first.";
    }
    return;
  }
  els.exportPopup.hidden = false;
  els.exportProgress.hidden = true;
  els.progressBarFill.style.transform = "scaleX(0)";
});

els.exportClose?.addEventListener("click", () => {
  els.exportPopup.hidden = true;
});

els.formatBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!lastArtifact || !lastArtifact.slug) {
      if (els.progressStatus) {
        els.exportPopup.hidden = false;
        els.exportProgress.hidden = true;
        els.progressStatus.textContent = "No part is loaded to export. Generate a design first.";
      }
      return;
    }
    const format = btn.dataset.fmt;
    const relPath = lastArtifact.slug + "/part.step"; // always convert from step
    
    // UI update
    els.exportProgress.hidden = false;
    els.progressBarFill.style.transform = "scaleX(0.2)";
    els.progressStatus.textContent = "Initializing...";
    
    // PNG is a render of the exact view the user sees, captured in-renderer.
    // Send the high-res data URL through so the main process can write it
    // directly (the CLI snapshot is only a fallback).
    let dataUrl = null;
    if (format === "png" && viewer?.captureHighRes) {
      try {
        els.progressStatus.textContent = "Capturing view...";
        dataUrl = await viewer.captureHighRes({ width: 2560 });
      } catch (err) {
        els.progressStatus.textContent = "PNG capture failed: " + (err?.message || err);
        return;
      }
    }
    
    // Setup listener for progress
    let unsub = null;
    if (cadara.file.onExportProgress) {
      unsub = cadara.file.onExportProgress((data) => {
        if (data.status === "converting") {
          els.progressBarFill.style.transform = "scaleX(0.7)";
          els.progressStatus.textContent = "Converting format...";
        }
      });
    }

    try {
      const res = await cadara.file.export({
        relPath,
        format,
        name: lastArtifact.slug + "." + format,
        dataUrl,
      });

      if (res.ok) {
        els.progressBarFill.style.transform = "scaleX(1)";
        els.progressStatus.textContent = "Export complete!";
        setTimeout(() => { els.exportPopup.hidden = true; }, 1500);
      } else if (res.canceled) {
        els.exportPopup.hidden = true;
      } else {
        els.progressStatus.textContent = "Error: " + res.error;
        els.progressBarFill.style.background = "var(--bad)";
      }
    } finally {
      if (unsub) unsub();
    }
  });
});
// -----------------------------------------------------------------------------
// Part Details drawer
// Shows the design summary, spec features/assumptions, geometry facts and
// build metadata for the currently displayed artifact.
// -----------------------------------------------------------------------------

function fmtNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return String(Math.round(v * 100) / 100).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function populateDetailsDrawer() {
  if (!lastArtifact) return;
  const info = lastResultInfo || {};
  const artifact = lastArtifact;

  // Summary
  const summary = info.summary || "";
  els.detailsSummary.textContent = summary || "No summary available for this part.";

  // Features from the design spec
  const features = Array.isArray(info.spec?.features) ? info.spec.features : [];
  if (features.length) {
    els.detailsFeatures.innerHTML = "";
    for (const f of features.slice(0, 24)) {
      const li = document.createElement("li");
      const name = f?.name || "feature";
      const desc = typeof f?.description === "string" && f.description ? " — " + f.description : "";
      li.textContent = name + desc;
      els.detailsFeatures.appendChild(li);
    }
    els.detailsFeaturesSec.hidden = false;
  } else {
    els.detailsFeaturesSec.hidden = true;
  }

  // Assumptions from the design spec
  const assumptions = Array.isArray(info.spec?.assumptions) ? info.spec.assumptions : [];
  if (assumptions.length) {
    els.detailsAssumptions.innerHTML = "";
    for (const a of assumptions.slice(0, 24)) {
      const li = document.createElement("li");
      li.textContent = a;
      els.detailsAssumptions.appendChild(li);
    }
    els.detailsAssumptionsSec.hidden = false;
  } else {
    els.detailsAssumptionsSec.hidden = true;
  }

  // Geometry facts
  const rows = detailsRowsFromFacts(artifact.facts);
  if (rows.length) {
    fillDetailsDl(els.detailsGeometry, rows);
    els.detailsGeometrySec.hidden = false;
  } else {
    els.detailsGeometrySec.hidden = true;
  }

  // Build meta
  const metaRows = [];
  const provider = info.provider || currentProvider();
  const providerLabel = provider ? PROVIDER_LABELS[provider] || provider : "";
  if (providerLabel && providerLabel !== "ollama") metaRows.push(["provider", providerLabel]);
  const model = info.model || els.modelSelect?.value || "";
  if (model) metaRows.push(["model", String(model).split(" — ")[0]]);
  if (artifact.displayName || artifact.slug) metaRows.push(["part", artifact.displayName || artifact.slug]);
  if (info.savedAt) {
    try {
      metaRows.push(["saved", new Date(info.savedAt).toLocaleString()]);
    } catch { /* ignore */ }
  }
  if (metaRows.length) {
    fillDetailsDl(els.detailsMeta, metaRows);
    els.detailsMetaSec.hidden = false;
  } else {
    els.detailsMetaSec.hidden = true;
  }
}

function toggleDetailsDrawer() {
  if (!lastArtifact) return;
  if (els.detailsDrawer.hidden) {
    populateDetailsDrawer();
    els.detailsDrawer.hidden = false;
    els.detailsBtn.classList.add("active");
  } else {
    hideDetailsDrawer();
  }
}

els.detailsBtn?.addEventListener("click", toggleDetailsDrawer);
els.detailsClose?.addEventListener("click", hideDetailsDrawer);

function hideDetailsDrawer() {
  if (els.detailsDrawer) els.detailsDrawer.hidden = true;
  if (els.detailsBtn) els.detailsBtn.classList.remove("active");
}

function detailsRowsFromFacts(facts) {
  if (!facts) return [];
  const rows = [];
  const size = facts.entryFacts?.size;
  if (Array.isArray(size)) {
    rows.push(["overall size", size.map(fmtNumber).join(" × ") + " mm"]);
  }
  if (facts.volume != null) rows.push(["volume", fmtNumber(facts.volume) + " mm³"]);
  if (facts.faceCount != null) rows.push(["faces", String(facts.faceCount)]);
  if (facts.edgeCount != null) rows.push(["edges", String(facts.edgeCount)]);
  if (facts.shapeCount != null) rows.push(["shapes", String(facts.shapeCount)]);
  if (facts.occurrenceCount != null) rows.push(["occurrences", String(facts.occurrenceCount)]);
  if (facts.bounds && Array.isArray(facts.bounds.min) && Array.isArray(facts.bounds.max)) {
    const [mn, mx] = [facts.bounds.min, facts.bounds.max];
    rows.push([
      "bounds (mm)",
      `[${mn.map(fmtNumber).join(", ")}] → [${mx.map(fmtNumber).join(", ")}]`,
    ]);
  }
  return rows;
}

function fillDetailsDl(dl, rows) {
  dl.innerHTML = "";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
}

// -----------------------------------------------------------------------------
// Projects Home Logic
// Every launch lands on the projects page. Left-click opens a project,
// right-click offers Open / Rename / Export / Delete. Designs created inside
// a project are saved back into it through writePreviousChats().
// -----------------------------------------------------------------------------

function setRailActive(activeId) {
  document.querySelectorAll(".rail .rail-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.id === activeId);
  });
}

function showProjectsHome() {
  renderProjectsHome();
  setRailActive("home-btn");
  els.landingPage.style.display = "";
  requestAnimationFrame(() => els.landingPage.classList.remove("hidden"));
}

function hideProjectsHome() {
  els.landingPage.classList.add("hidden");
  // Wait for the fade-out transition before removing from DOM flow.
  setTimeout(() => {
    if (els.landingPage.classList.contains("hidden")) {
      els.landingPage.style.display = "none";
    }
  }, 800);
}

function projectMetaLine(project) {
  const count = (project.items || []).length;
  const designs = `${count} design${count === 1 ? "" : "s"}`;
  const stamp = project.updatedAt || project.createdAt;
  const when = stamp
    ? new Date(stamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
    : "";
  return when ? `${designs} · ${when}` : designs;
}

function renderProjectsHome() {
  if (!els.projectsGrid) return;
  updateResumeButton();
  els.projectsGrid.innerHTML = "";

  const newCard = document.createElement("button");
  newCard.type = "button";
  newCard.className = "project-card new-project-card";
  newCard.innerHTML = `
    <span class="new-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
    </span>
    <span class="project-name">New Project</span>`;
  newCard.addEventListener("click", () => createProject());
  els.projectsGrid.appendChild(newCard);

  for (const project of sortedProjects()) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "project-card";
    card.dataset.projectId = project.id;

    const thumb = document.createElement("div");
    thumb.className = "project-thumb";
    thumb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5"/><path d="M12 12v9"/></svg>`;

    const info = document.createElement("div");
    info.className = "project-info";
    const name = document.createElement("div");
    name.className = "project-name";
    name.textContent = project.name;
    const meta = document.createElement("div");
    meta.className = "project-meta";
    meta.textContent = projectMetaLine(project);
    info.appendChild(name);
    info.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(info);
    card.title = `${project.name} — ${projectMetaLine(project)}`;
    card.addEventListener("click", () => openProject(project.id));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showProjectContextMenu(e.clientX, e.clientY, project.id);
    });
    els.projectsGrid.appendChild(card);
  }
}

function lastWorkedProject() {
  const sorted = sortedProjects();
  return sorted.length ? sorted[0] : null;
}

function resumeLastProject() {
  const last = lastWorkedProject();
  if (last) openProject(last.id);
  else createProject();
}

function fitProjectName(name, max = 22) {
  const s = String(name || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 5)) + "…" + s.slice(-2);
}

function updateResumeButton() {
  if (!els.projectsResumeBtn || !els.projectsResumeLabel) return;
  const last = lastWorkedProject();
  if (last) {
    const count = (last.items || []).length;
    els.projectsResumeLabel.textContent = "Resume " + fitProjectName(last.name);
    els.projectsResumeBtn.title =
      `Continue “${last.name}” — ${count} design${count === 1 ? "" : "s"}, last edited ` +
      (last.updatedAt ? new Date(last.updatedAt).toLocaleString() : "recently");
    els.projectsResumeBtn.disabled = false;
  } else {
    els.projectsResumeLabel.textContent = "New Project";
    els.projectsResumeBtn.title = "No projects yet — create your first project";
    els.projectsResumeBtn.disabled = false;
  }
}

function createProject() {
  const existing = new Set(projects.map((p) => p.name));
  let name = "Untitled Project";
  for (let n = 2; existing.has(name); n++) name = `Untitled Project ${n}`;
  const now = new Date().toISOString();
  const project = { id: projectUid(), name, createdAt: now, updatedAt: now, items: [] };
  projects.push(project);
  activeProjectId = project.id;
  persistProjects();
  openProject(project.id);
}

async function openProject(id) {
  const project = projectById(id);
  if (!project) return;
  activeProjectId = id;
  // Mark this project as the most-recently worked-on so the home screen's
  // “Resume last project” button lands right back here next time.
  project.updatedAt = new Date().toISOString();
  persistProjects();
  hideProjectsHome();
  hideProjectContextMenu();
  historyItems = project.items || [];
  historyQuery = "";
  if (els.historySearch) els.historySearch.value = "";
  renderPreviousChats();
  const items = readPreviousChats();
  if (items.length) {
    await openPreviousChat(items[0], { announce: true });
  } else {
    clearActiveDesignView({ clearTranscript: true });
    if (hasKey) showSuggestions();
    els.prompt.focus();
  }
}

function openRenameModal(id) {
  const project = projectById(id);
  if (!project) return;
  renameTargetId = id;
  els.projectRenameInput.value = project.name;
  els.projectRenameModal.hidden = false;
  els.projectRenameInput.focus();
  els.projectRenameInput.select();
}

function closeRenameModal() {
  els.projectRenameModal.hidden = true;
  renameTargetId = null;
}

function commitRename() {
  const project = projectById(renameTargetId);
  const name = els.projectRenameInput.value.trim();
  closeRenameModal();
  if (!project || !name) return;
  project.name = name;
  project.updatedAt = new Date().toISOString();
  persistProjects();
}

function deleteProject(id) {
  const project = projectById(id);
  if (!project) return;
  const count = (project.items || []).length;
  const ok = window.confirm(
    `Delete “${project.name}”?` + (count ? ` ${count} design${count === 1 ? "" : "s"} inside will be removed too.` : "")
  );
  if (!ok) return;
  projects = projects.filter((p) => p.id !== id);
  if (activeProjectId === id) activeProjectId = null;
  persistProjects();
}

// --- right-click context menu (created once, reused for every card) ---------

const contextMenu = document.createElement("div");
contextMenu.id = "project-context-menu";
contextMenu.className = "context-menu";
contextMenu.hidden = true;

const MENU_ITEMS = [
  {
    label: "Open",
    icon: `<svg viewBox="0 0 24 24"><path d="M4 19V5h6l2 2h8v12Z"/></svg>`,
    action: (id) => openProject(id),
  },
  {
    label: "Rename",
    icon: `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg>`,
    action: (id) => openRenameModal(id),
  },
  {
    label: "Delete",
    danger: true,
    icon: `<svg viewBox="0 0 24 24"><path d="M5 7h14"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/></svg>`,
    action: (id) => deleteProject(id),
  },
];

for (const [index, item] of MENU_ITEMS.entries()) {
  if (item.danger && index > 0 && !MENU_ITEMS[index - 1].danger) {
    const sep = document.createElement("div");
    sep.className = "context-menu-sep";
    contextMenu.appendChild(sep);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "context-menu-item" + (item.danger ? " danger" : "");
  btn.innerHTML = `${item.icon}<span>${item.label}</span>`;
  btn.addEventListener("click", () => {
    const id = contextMenu.dataset.projectId;
    hideProjectContextMenu();
    if (id) item.action(id);
  });
  contextMenu.appendChild(btn);
}
document.body.appendChild(contextMenu);

function showProjectContextMenu(x, y, projectId) {
  contextMenu.dataset.projectId = projectId;
  contextMenu.hidden = false;
  const rect = contextMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  contextMenu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  contextMenu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

function hideProjectContextMenu() {
  contextMenu.hidden = true;
}

document.addEventListener("click", (e) => {
  if (!contextMenu.hidden && !contextMenu.contains(e.target)) hideProjectContextMenu();
});
document.addEventListener("contextmenu", (e) => {
  if (!contextMenu.hidden && !contextMenu.contains(e.target) && !e.target.closest(".project-card")) {
    hideProjectContextMenu();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideProjectContextMenu();
    hideDetailsDrawer();
    if (!els.exportPopup.hidden) els.exportPopup.hidden = true;
    if (!els.projectRenameModal.hidden) closeRenameModal();
  }
});

els.projectRenameSave.addEventListener("click", commitRename);
els.projectRenameCancel.addEventListener("click", closeRenameModal);
els.projectRenameModal.addEventListener("click", (e) => {
  if (e.target === els.projectRenameModal) closeRenameModal();
});
els.projectRenameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitRename();
  }
});

els.projectsResumeBtn.addEventListener("click", resumeLastProject);
els.homeBtn.addEventListener("click", () => goHome());

init();
