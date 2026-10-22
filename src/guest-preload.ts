import { ipcRenderer, webFrame } from 'electron';

// Runs before Facebook's page does, so the app's layout CSS is in place for the very first paint. As a user
// stylesheet its !important rules outrank Facebook's own !important ones, whatever their specificity.
webFrame.insertCSS(ipcRenderer.sendSync('guest-startup-css'), { cssOrigin: 'user' });

// Facebook's loading shell puts the thread's rounded card straight inside the thread column, flush against
// where its banner would be (the window top here); the real page wraps it in a 16px inset. Mark the shell so the
// startup CSS can give it that inset, until the real layout takes over.
const FLUSH_CLASS = 'own-messenger-thread-flush';

function markFlushLoadingThread(): void {
  const root = document.documentElement;
  const card = document.querySelector('[role="navigation"] ~ [role="main"]')?.firstElementChild;
  const flush = !!card && getComputedStyle(card).borderTopLeftRadius !== '0px';
  root?.classList.toggle(FLUSH_CLASS, flush);
  if (!card || flush) requestAnimationFrame(markFlushLoadingThread);
}

requestAnimationFrame(markFlushLoadingThread);
