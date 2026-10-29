import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  copyToClipboard: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  toggleSidebar: () => ipcRenderer.send('toggle-sidebar'),
  initialSidebarEdge: ipcRenderer.sendSync('get-sidebar-edge') as number,
  onSidebarEdgeChange: (callback: (edge: number, zoom: number) => void) =>
    ipcRenderer.on('sidebar-edge-changed', (_, edge: number, zoom: number) => callback(edge, zoom)),
  onGuestOverlayChange: (callback: (overlaid: boolean) => void) =>
    ipcRenderer.on('guest-overlay-changed', (_, overlaid: boolean) => callback(overlaid)),
  onFullScreenChange: (callback: (isFullScreen: boolean) => void) =>
    ipcRenderer.on('full-screen-changed', (_, isFullScreen: boolean) => callback(isFullScreen)),
});
