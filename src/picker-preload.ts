import { contextBridge, ipcRenderer } from 'electron';

interface SourceData {
  id: string;
  name: string;
  thumbnail: string;
}

contextBridge.exposeInMainWorld('pickerAPI', {
  onSources: (callback: (sources: SourceData[]) => void) => {
    ipcRenderer.on('sources', (_, sources: SourceData[]) => callback(sources));
  },
  selectSource: (sourceId: string) => ipcRenderer.send('source-selected', sourceId),
  cancel: () => ipcRenderer.send('picker-cancelled'),
});
