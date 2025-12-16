interface ElectronAPI {
  platform: string;
  openExternal: (url: string) => Promise<void>;
}

interface Window {
  electronAPI: ElectronAPI;
}
