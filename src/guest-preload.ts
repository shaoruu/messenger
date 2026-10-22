import { ipcRenderer, webFrame } from 'electron';

// Runs before Facebook's page does, so the app's layout CSS is in place for the very first paint. As a user
// stylesheet its !important rules outrank Facebook's own !important ones, whatever their specificity.
webFrame.insertCSS(ipcRenderer.sendSync('guest-startup-css'), { cssOrigin: 'user' });
