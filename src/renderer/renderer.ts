const webview = document.getElementById('messenger') as Electron.WebviewTag;
const backBtn = document.getElementById('back') as HTMLButtonElement;
const forwardBtn = document.getElementById('forward') as HTMLButtonElement;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;

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
