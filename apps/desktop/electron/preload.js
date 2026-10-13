const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // main window
  onTaskAdd: (fn) => ipcRenderer.on('task:add', (_e, text) => fn(text)),
  shortcuts: () => ipcRenderer.invoke('app:shortcuts'),
  // AI provider requests (made by the main process)
  aiRequest: (req) => ipcRenderer.invoke('ai:request', req),
  // phone sync hub
  sync: (state) => ipcRenderer.invoke('sync:exchange', state),
  onSyncChanged: (fn) => ipcRenderer.on('sync:changed', () => fn()),
  pairInfo: () => ipcRenderer.invoke('sync:pair-info'),
  resetPairing: () => ipcRenderer.invoke('sync:reset-pairing'),
  // quick-add window
  submitQuickAdd: (text) => ipcRenderer.send('quickadd:submit', text),
  closeQuickAdd: () => ipcRenderer.send('quickadd:close'),
  onQuickAddReset: (fn) => ipcRenderer.on('quickadd:reset', () => fn()),
});
