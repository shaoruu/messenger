import { app, BrowserWindow, session, ipcMain, shell, clipboard, Menu, desktopCapturer } from 'electron';
import * as path from 'path';

type DisplayMediaCallback = (streams: { video?: Electron.Video }) => void;
let pendingDisplayMediaCallback: DisplayMediaCallback | null = null;

function createPickerWindow(mainWindow: BrowserWindow, sources: Electron.DesktopCapturerSource[]): BrowserWindow {
  const pickerWindow = new BrowserWindow({
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

  pickerWindow.loadFile(path.join(__dirname, '..', 'src', 'picker', 'picker.html'));

  pickerWindow.webContents.on('did-finish-load', () => {
    const sourcesData = sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
    pickerWindow.webContents.send('sources', sourcesData);
    pickerWindow.show();
  });

  return pickerWindow;
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

  mainWindow.webContents.on('did-attach-webview', (_, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      const isMessengerURL = !url || url === 'about:blank' || url.startsWith('https://www.messenger.com') || url.startsWith('https://messenger.com');
      if (isMessengerURL) {
        return { action: 'allow' };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }).then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }

        pendingDisplayMediaCallback = callback;
        createPickerWindow(mainWindow, sources);
      });
    });
  });
}

app.whenReady().then(() => {
  createWindow();

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

ipcMain.on('source-selected', (event, sourceId: string) => {
  const pickerWindow = BrowserWindow.fromWebContents(event.sender);
  if (pickerWindow) {
    pickerWindow.close();
  }

  if (pendingDisplayMediaCallback && sourceId) {
    pendingDisplayMediaCallback({ video: { id: sourceId, name: sourceId } });
    pendingDisplayMediaCallback = null;
  }
});

ipcMain.on('picker-cancelled', (event) => {
  const pickerWindow = BrowserWindow.fromWebContents(event.sender);
  if (pickerWindow) {
    pickerWindow.close();
  }

  if (pendingDisplayMediaCallback) {
    pendingDisplayMediaCallback({});
    pendingDisplayMediaCallback = null;
  }
});
