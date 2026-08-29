const { contextBridge } = require("electron");

const PART = {
  slug: "a-60-40-15", dir: "a-60-40-15", sourcePath: "a-60-40-15/part.py",
  pythonSource: "# sample", stepPath: "a-60-40-15/part.step",
  glbPath: "a-60-40-15/part.glb", stlPath: "a-60-40-15/part.stl",
  viewerGlb: "a-60-40-15/.part.step.glb",
  facts: { entryFacts: { size: [60, 40, 15] }, faceCount: 16, bounds: { min: [0,0,0], max: [60,40,15] } },
};

contextBridge.exposeInMainWorld("cadara", {
  settings: { get: async () => ({ hasGeminiKey: true }), getKeys: async () => ({}), set: async () => ({ ok: true }), test: async () => ({ ok: true }), getAiConfig: async () => ({ ok: true }), setAiConfig: async () => ({ ok: true }) },
  skills: { list: async () => [], save: async () => ({ ok: true }), delete: async () => ({ ok: true }) },
  chat: { send: async () => ({ ok: false, error: "mock" }), cancel: async () => ({ ok: true }), onEvent: () => () => {} },
  file: { save: async () => ({ ok: true }), export: async () => ({ ok: true }), reveal: async () => ({ ok: true }), onExportProgress: () => () => {} },
  session: { clear: async () => ({ ok: true }), restore: async () => ({ ok: true }) },
  history: { list: async () => [], save: async () => ({ ok: true }), remove: async () => ({ ok: true }), clear: async () => ({ ok: true }), importLegacy: async () => ({ ok: true }) },
  texture: { generate: async () => ({ ok: true, spec: { color: "#fff" } }) },
  ollama: { status: async () => ({ ok: true }), pull: async () => ({ ok: true }), onPullProgress: () => () => {} },
  meta: async () => ({ modelsRoot: "", defaultProvider: "gemini", defaultModel: "gemini-x",
    providers: { gemini: { label: "Gemini", hasKey: true, models: [{ id: "gemini-x", label: "Gemini X", supportsVision: true }], packets: [] } } }),
});