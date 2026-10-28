interface ElectronAPI {
  platform: string;
  copyToClipboard: (text: string) => void;
  openExternal: (url: string) => void;
  toggleSidebar: () => void;
  initialSidebarEdge: number;
  onSidebarEdgeChange: (callback: (edge: number) => void) => void;
  onGuestOverlayChange: (callback: (overlaid: boolean) => void) => void;
  onFullScreenChange: (callback: (isFullScreen: boolean) => void) => void;
}

const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;

const webview = document.getElementById('messenger') as Electron.WebviewTag;
const sidebarBtn = document.getElementById('sidebar') as HTMLButtonElement;

api.onFullScreenChange((isFullScreen) => {
  document.body.classList.toggle('fullscreen', isFullScreen);
});

// Facebook's photo viewer fills the window, so the bar would only cut into its corner.
api.onGuestOverlayChange((overlaid) => {
  document.body.classList.toggle('guest-overlay', overlaid);
});

function setSidebarEdge(edge: number): void {
  document.documentElement.style.setProperty('--sidebar-edge', edge + 'px');
  document.body.classList.toggle('has-sidebar', edge > 0);
}

// Last launch's edge, so the window opens split instead of once the page has loaded.
setSidebarEdge(api.initialSidebarEdge);
api.onSidebarEdgeChange(setSidebarEdge);

function isFacebookURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'www.facebook.com' ||
      parsed.hostname === 'facebook.com' ||
      parsed.hostname === 'www.messenger.com' ||
      parsed.hostname === 'messenger.com'
    );
  } catch {
    return false;
  }
}

sidebarBtn.addEventListener('click', () => {
  api.toggleSidebar();
});

webview.addEventListener('new-window', (e) => {
  const event = e as Electron.DidCreateWindowDetails & Event & { url: string };
  e.preventDefault();
  if (event.url && !isFacebookURL(event.url)) {
    api.openExternal(event.url);
  }
});

webview.addEventListener('will-navigate', (e) => {
  const event = e as Electron.WillNavigateEvent;
  if (event.url && !isFacebookURL(event.url)) {
    e.preventDefault();
    api.openExternal(event.url);
  }
});
