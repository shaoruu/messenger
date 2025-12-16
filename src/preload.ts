import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
});
