interface ElectronAPI {
  platform: string;
  copyToClipboard: (text: string) => void;
  openExternal: (url: string) => void;
  showLinkContextMenu: (linkURL: string) => void;
}

const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;

const webview = document.getElementById('messenger') as Electron.WebviewTag;
const backBtn = document.getElementById('back') as HTMLButtonElement;
const forwardBtn = document.getElementById('forward') as HTMLButtonElement;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;

function isMessengerURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.messenger.com' || parsed.hostname === 'messenger.com';
  } catch {
    return false;
  }
}

function updateNavButtons(): void {
  backBtn.disabled = !webview.canGoBack();
  forwardBtn.disabled = !webview.canGoForward();
}

webview.addEventListener('did-navigate', updateNavButtons);
webview.addEventListener('did-navigate-in-page', updateNavButtons);

backBtn.addEventListener('click', () => {
  if (webview.canGoBack()) {
    webview.goBack();
  }
});

forwardBtn.addEventListener('click', () => {
  if (webview.canGoForward()) {
    webview.goForward();
  }
});

refreshBtn.addEventListener('click', () => {
  webview.reload();
});

webview.addEventListener('dom-ready', () => {
  updateNavButtons();
});

webview.addEventListener('context-menu', (e) => {
  const event = e as Electron.ContextMenuEvent;
  if (event.params.linkURL) {
    api.showLinkContextMenu(event.params.linkURL);
  }
});

webview.addEventListener('new-window', (e) => {
  const event = e as Electron.DidCreateWindowDetails & Event & { url: string };
  e.preventDefault();
  if (event.url && !isMessengerURL(event.url)) {
    api.openExternal(event.url);
  }
});

webview.addEventListener('will-navigate', (e) => {
  const event = e as Electron.WillNavigateEvent;
  if (event.url && !isMessengerURL(event.url)) {
    e.preventDefault();
    api.openExternal(event.url);
  }
});
