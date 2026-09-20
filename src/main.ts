import { app, BrowserWindow, session, ipcMain, shell, clipboard, Menu, desktopCapturer, systemPreferences } from 'electron';
import * as path from 'path';

type DisplayMediaCallback = (streams: { video?: Electron.Video }) => void;
let pendingDisplayMediaCallback: DisplayMediaCallback | null = null;
let pendingSources: Electron.DesktopCapturerSource[] = [];
let pickerWindow: BrowserWindow | null = null;
let screenSharePickerActive = false;

function settleDisplayMedia(source: Electron.DesktopCapturerSource | null): void {
  const callback = pendingDisplayMediaCallback;
  pendingDisplayMediaCallback = null;
  pendingSources = [];
  screenSharePickerActive = false;

  const openPicker = pickerWindow;
  pickerWindow = null;
  if (openPicker && !openPicker.isDestroyed()) {
    openPicker.close();
  }

  if (callback) {
    callback(source ? { video: source } : {});
  }
}

function createPickerWindow(mainWindow: BrowserWindow, sources: Electron.DesktopCapturerSource[]): void {
  const existing = pickerWindow;
  pickerWindow = null;
  if (existing && !existing.isDestroyed()) {
    existing.close();
  }

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    parent: mainWindow,
    modal: true,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'picker-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pickerWindow = win;

  win.loadFile(path.join(__dirname, '..', 'src', 'picker', 'picker.html'));

  win.webContents.on('did-finish-load', () => {
    const sourcesData = sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
    win.webContents.send('sources', sourcesData);
    win.show();
  });

  win.on('closed', () => {
    if (pickerWindow !== win) {
      return;
    }
    pickerWindow = null;
    if (pendingDisplayMediaCallback) {
      settleDisplayMedia(null);
    }
  });
}

async function requestMacMediaAccess(mediaTypes?: Array<'video' | 'audio'>): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  const types = mediaTypes ?? ['video', 'audio'];
  if (types.includes('video')) {
    await systemPreferences.askForMediaAccess('camera');
  }
  if (types.includes('audio')) {
    await systemPreferences.askForMediaAccess('microphone');
  }
}

function setupMediaCapture(ses: Electron.Session, mainWindow: BrowserWindow): void {
  ses.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission === 'media' && process.platform === 'darwin') {
      if (details.mediaType === 'video') {
        return systemPreferences.getMediaAccessStatus('camera') === 'granted';
      }
      if (details.mediaType === 'audio') {
        return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
      }
    }
    return true;
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'display-capture') {
      screenSharePickerActive = true;
      callback(true);
      return;
    }
    if (permission === 'media') {
      const mediaTypes = (details as Electron.MediaAccessPermissionRequest).mediaTypes;
      void requestMacMediaAccess(mediaTypes).then(() => callback(true));
      return;
    }
    callback(true);
  });

  // On macOS 15+ the system picker is used and this handler is not called.
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      screenSharePickerActive = true;
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 },
        });
        if (sources.length === 0) {
          screenSharePickerActive = false;
          callback({});
          return;
        }

        pendingSources = sources;
        pendingDisplayMediaCallback = callback;
        createPickerWindow(mainWindow, sources);
      } catch (error) {
        console.error('Screen share: failed to list sources', error);
        screenSharePickerActive = false;
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

function createWindow(): void {
  const partition = 'persist:messenger';
  const ses = session.fromPartition(partition);

  ses.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  setupMediaCapture(ses, mainWindow);

  mainWindow.webContents.on('did-attach-webview', (_, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      const isFacebookURL =
        !url ||
        url === 'about:blank' ||
        url.startsWith('https://www.facebook.com') ||
        url.startsWith('https://facebook.com') ||
        url.startsWith('https://www.messenger.com') ||
        url.startsWith('https://messenger.com');
      if (isFacebookURL) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              partition: 'persist:messenger',
            },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  void requestMacMediaAccess();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('copy-to-clipboard', (_, text: string) => {
  clipboard.writeText(text);
});

ipcMain.on('open-external', (_, url: string) => {
  shell.openExternal(url);
});

ipcMain.on('show-link-context-menu', (event, linkURL: string) => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Copy Link',
      click: () => {
        clipboard.writeText(linkURL);
      },
    },
    {
      label: 'Open in Browser',
      click: () => {
        shell.openExternal(linkURL);
      },
    },
  ]);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    menu.popup({ window });
  }
});

ipcMain.on('source-selected', (_event, sourceId: string) => {
  const source = pendingSources.find((item) => item.id === sourceId) ?? null;
  settleDisplayMedia(source);
});

ipcMain.on('picker-cancelled', () => {
  settleDisplayMedia(null);
});
