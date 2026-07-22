const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('collector', {
  getState: () => ipcRenderer.invoke('state:get'), onState: callback => ipcRenderer.on('state:changed', (_event, state) => callback(state)),
  start: () => ipcRenderer.invoke('collector:start'), pause: () => ipcRenderer.invoke('collector:pause'), resume: () => ipcRenderer.invoke('collector:resume'), stop: () => ipcRenderer.invoke('collector:stop'), retry: () => ipcRenderer.invoke('collector:retry'), reset: () => ipcRenderer.invoke('collector:reset'),
  updateSettings: settings => ipcRenderer.invoke('settings:update', settings), updateCategories: config => ipcRenderer.invoke('categories:update', config), exportMaster: () => ipcRenderer.invoke('export:master'), exportLinks: () => ipcRenderer.invoke('export:links'), mergeResults: () => ipcRenderer.invoke('merge:results'), openData: () => ipcRenderer.invoke('folder:open-data')
  , configureTask: task => ipcRenderer.invoke('task:configure', task), openRuleDesigner: url => ipcRenderer.invoke('rules:open-designer', url), getRules: () => ipcRenderer.invoke('rules:get'), onRuleSaved: callback => ipcRenderer.on('rule:saved', (_event, rule) => callback(rule))
});
