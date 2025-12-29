import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  copyToClipboard: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  showLinkContextMenu: (linkURL: string) => ipcRenderer.send('show-link-context-menu', linkURL),
});
