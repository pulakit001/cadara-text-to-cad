const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cadara", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    getKeys: () => ipcRenderer.invoke("settings:getKeys"),
    addKey: (args) => ipcRenderer.invoke("settings:addKey", args),
    removeKey: (args) => ipcRenderer.invoke("settings:removeKey", args),
    toggleKey: (args) => ipcRenderer.invoke("settings:toggleKey", args),
    set: (keys) => ipcRenderer.invoke("settings:set", keys || {}),
    test: (provider, apiKey) => ipcRenderer.invoke("settings:test", { provider, apiKey }),
    getAiConfig: () => ipcRenderer.invoke("settings:getAiConfig"),
    setAiConfig: (config) => ipcRenderer.invoke("settings:setAiConfig", config || {}),
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list"),
    save: (skill) => ipcRenderer.invoke("skills:save", skill),
    delete: (id) => ipcRenderer.invoke("skills:delete", id),
  },
  chat: {
    send: (prompt, provider, model, referenceImage, clientJobId) =>
      ipcRenderer.invoke("chat:send", { prompt, provider, model, referenceImage, clientJobId }),
    cancel: () => ipcRenderer.invoke("chat:cancel"),
    onEvent: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on("chat:event", listener);
      return () => ipcRenderer.removeListener("chat:event", listener);
    },
  },
  file: {
    info: (relPath) => ipcRenderer.invoke("file:info", relPath),
    save: (args) => ipcRenderer.invoke("file:save", args),
    export: (args) => ipcRenderer.invoke("file:export", args),
    reveal: (path) => ipcRenderer.invoke("file:reveal", { path }),
    onExportProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on("file:exportProgress", listener);
      return () => ipcRenderer.removeListener("file:exportProgress", listener);
    },
  },
  session: {
    clear: () => ipcRenderer.invoke("session:clear"),
    restore: (entry) => ipcRenderer.invoke("session:restore", { entry }),
  },
  history: {
    list: () => ipcRenderer.invoke("history:list"),
    save: (entry) => ipcRenderer.invoke("history:save", entry),
    remove: (id) => ipcRenderer.invoke("history:delete", id),
    clear: () => ipcRenderer.invoke("history:clear"),
    importLegacy: (items) => ipcRenderer.invoke("history:importLegacy", items),
  },
  texture: {
    generate: (description, provider, model, artifact) =>
      ipcRenderer.invoke("texture:generate", { description, provider, model, artifact }),
  },
  ollama: {
    status: () => ipcRenderer.invoke("ollama:status"),
    pull: (model) => ipcRenderer.invoke("ollama:pull", { model }),
    onPullProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on("ollama:pullProgress", listener);
      return () => ipcRenderer.removeListener("ollama:pullProgress", listener);
    },
  },
  meta: () => ipcRenderer.invoke("app:meta"),
});
