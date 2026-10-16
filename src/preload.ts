import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  copyToClipboard: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onFullScreenChange: (callback: (isFullScreen: boolean) => void) =>
    ipcRenderer.on('full-screen-changed', (_, isFullScreen: boolean) => callback(isFullScreen)),
});
