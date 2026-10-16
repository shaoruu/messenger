import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  copyToClipboard: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
});
