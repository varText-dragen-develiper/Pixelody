const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('moduleShop', { request: request => ipcRenderer.invoke('modules:request', request) });
