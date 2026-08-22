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
    onExportProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on("file:exportProgress", listener);
      return () => ipcRenderer.removeListener("file:exportProgress", listener);
    },
  },
  session: {
    clear: () => ipcRenderer.invoke("session:clear"),
  },
  texture: {
    generate: (description, provider, model, artifact) =>
      ipcRenderer.invoke("texture:generate", { description, provider, model, artifact }),
  },
  meta: () => ipcRenderer.invoke("app:meta"),
});
