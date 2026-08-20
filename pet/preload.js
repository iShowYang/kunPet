const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kunpet", {
  onCelebrate: (cb) => ipcRenderer.on("pet:celebrate", () => cb()),
  onWalkStart: (cb) =>
    ipcRenderer.on("pet:walk-start", (_e, payload) => cb(payload)),
  onWalkEnd: (cb) => ipcRenderer.on("pet:walk-end", () => cb()),
  onWalkFrame: (cb) =>
    ipcRenderer.on("pet:walk-frame", (_e, payload) => cb(payload)),
  onIdle: (cb) => ipcRenderer.on("pet:idle", () => cb()),
  onWorking: (cb) => ipcRenderer.on("pet:working", () => cb()),
  dismissCelebrate: () => ipcRenderer.send("pet:dismiss-celebrate"),
});
