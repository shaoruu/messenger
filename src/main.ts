import { app, BrowserWindow, session, ipcMain, shell, clipboard, Menu, desktopCapturer } from 'electron';
import * as path from 'path';

type DisplayMediaCallback = (streams: { video?: Electron.Video }) => void;
let pendingDisplayMediaCallback: DisplayMediaCallback | null = null;

let messengerShortcutWebContents: Electron.WebContents | null = null;

type MessengerDomReadyInstaller = {
  wc: Electron.WebContents;
  fn: () => void;
};

let messengerGuestDomReadyCleanup: MessengerDomReadyInstaller | null = null;

function isSearchChatsAccelerator(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.isAutoRepeat || input.isComposing) return false;
  if (!(input.meta || input.control)) return false;
  if (input.alt || input.shift) return false;
  return input.key.toLowerCase() === 'k';
}

function isFocusComposerAccelerator(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.isAutoRepeat || input.isComposing) return false;
  if (!(input.meta || input.control)) return false;
  if (input.alt || input.shift) return false;
  return input.key.toLowerCase() === 'i';
}

function isAltChatNavAccelerator(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.isAutoRepeat || input.isComposing) return false;
  if (!input.alt || input.control || input.meta || input.shift) return false;
  return input.key === 'ArrowUp' || input.key === 'ArrowDown';
}

function isCmdChatIndexAccelerator(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.isAutoRepeat || input.isComposing) return false;
  if (!(input.meta || input.control)) return false;
  if (input.alt || input.shift) return false;
  return input.key.length === 1 && input.key >= '1' && input.key <= '9';
}

const INSTALL_MESSENGER_INBOX_SEARCH_HOTKEY_SCRIPT = `
  void (function () {
    var NS = '__ownMessengerInboxSearchHotkey';
    function hint(el) {
      var aria = el.getAttribute('aria-label');
      var ttl = el.getAttribute('title');
      return ('' + el.placeholder + ' ' + (aria == null ? '' : aria) + ' ' + (ttl == null ? '' : ttl)).toLowerCase();
    }
    function passesMessengerLabels(h) {
      if (h.indexOf('marketplace') !== -1) return false;
      if (h.indexOf('search messenger') !== -1 || h.indexOf('search messages') !== -1) return true;
      if (h.indexOf('messenger') !== -1 && h.indexOf('search') !== -1) return true;
      return false;
    }
    function pickMessengerSearchInput(isStrictAboutFacebook) {
      var inputs = document.querySelectorAll(
        'input[type="text"], input[type="search"], input[placeholder]:not([type]), input:not([type])'
      );
      var i;
      var el;
      var h;
      for (i = 0; i < inputs.length; i++) {
        el = inputs.item(i);
        if (!(el instanceof HTMLInputElement)) continue;
        if (el.disabled || el.type === 'hidden') continue;
        h = hint(el);
        if (isStrictAboutFacebook && h.indexOf('search facebook') !== -1) continue;
        if (passesMessengerLabels(h)) return el;
      }
      return null;
    }
    function pickMessengerSearchInputAnyStrictness() {
      return pickMessengerSearchInput(true) || pickMessengerSearchInput(false);
    }
    function selectInput(el) {
      el.focus({ preventScroll: true });
      if (typeof el.select === 'function') el.select();
    }
    function isMessengerSearchInput(el) {
      if (!(el instanceof HTMLInputElement)) return false;
      return passesMessengerLabels(hint(el));
    }
    function rectRight(el) {
      return el.getBoundingClientRect().right;
    }
    function looksLikeLeftPaneInteractive(el) {
      if (!(el instanceof Element)) return false;
      var innerWidth = window.innerWidth;
      var r = el.getBoundingClientRect();
      return r.left < innerWidth * 0.55 && r.width > 0 && r.right < innerWidth * 0.6;
    }
    function looksLikeSearchPickEnterTarget(targetEl) {
      if (!(targetEl instanceof Element)) return false;
      if (!looksLikeLeftPaneInteractive(targetEl)) return false;
      var rowish = targetEl.closest('[role="option"], [role="gridcell"], [role="row"]');
      return !!rowish;
    }
    function isProbablyMessageComposer(activeEl) {
      if (!(activeEl instanceof HTMLElement)) return false;
      if (!(activeEl.getAttribute('role') === 'textbox')) return false;
      if (!(activeEl.getAttribute('contenteditable') === 'true')) return false;
      var lbl = hint(activeEl);
      if (lbl.indexOf('search') !== -1) return false;
      var r = rectRight(activeEl);
      return r > window.innerWidth * 0.38;
    }
    function resolveComposerField() {
      var nodes = document.querySelectorAll(
        '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor="true"]'
      );
      var innerW = window.innerWidth;
      var innerH = window.innerHeight;
      var bestEl = null;
      var bestScore = -1;
      var i;
      var el;
      var r;
      var h;
      var lbl;
      var score;
      for (i = 0; i < nodes.length; i++) {
        el = nodes.item(i);
        if (!(el instanceof HTMLElement)) continue;
        r = el.getBoundingClientRect();
        if (r.width < 48 || r.height < 8) continue;
        if (r.right <= innerW * 0.38 || r.bottom <= 0 || r.top >= innerH) continue;
        if (
          typeof el.checkVisibility === 'function' &&
          !el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
        ) {
          continue;
        }
        h = hint(el);
        if (h.indexOf('search') !== -1) continue;
        lbl = (el.getAttribute('aria-placeholder') || el.getAttribute('data-placeholder') || '').toLowerCase();
        score = r.bottom / innerH;
        if (h.indexOf('message') !== -1) score += 4;
        if (lbl.indexOf('aa') !== -1) score += 2;
        if (el.getAttribute('data-lexical-editor') === 'true') score += 1;
        if (score > bestScore) {
          bestEl = el;
          bestScore = score;
        }
      }
      return bestEl;
    }
    function isEditableElement(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
      if (!(el instanceof HTMLInputElement)) return false;
      return ['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'file', 'range', 'color'].indexOf(el.type) === -1;
    }
    function focusComposer(el) {
      var sel = window.getSelection();
      var hadCaretInside = !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
      el.focus({ preventScroll: true });
      if (!sel || hadCaretInside || document.activeElement !== el) return;
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    function shouldPullFocusToComposer(active, composer, startActive, previous) {
      if (active === composer) return false;
      if (!(active instanceof HTMLElement) || active === document.body) return true;
      if (active === startActive || active === previous) return true;
      if (active.closest('[role="dialog"], [aria-modal="true"]')) return false;
      return !isEditableElement(active);
    }
    function cancelComposerFocus() {
      window.__ownMessengerComposerFocusToken = (window.__ownMessengerComposerFocusToken || 0) + 1;
    }
    function focusComposerAfterNavigation(targetMarker, navigate) {
      cancelComposerFocus();
      var token = window.__ownMessengerComposerFocusToken;
      var startMarker = currentThreadMarkerFromLocation();
      // The old thread's composer can stay mounted until the new thread renders; typing into it would go to the previous chat.
      var previous = targetMarker && targetMarker !== startMarker ? resolveComposerField() : null;
      var startActive = document.activeElement;
      var previousChanged = false;
      var observer = null;
      if (previous) {
        if (startActive === previous) previous.blur();
        observer = new MutationObserver(function () {
          previousChanged = true;
        });
        observer.observe(previous, { childList: true, subtree: true, characterData: true });
      }
      if (navigate) navigate();
      var startedAt = Date.now();
      var arrivedAt = targetMarker ? 0 : startedAt;
      function tick() {
        var now = Date.now();
        if (window.__ownMessengerComposerFocusToken !== token || now - startedAt > 4000) {
          if (observer) observer.disconnect();
          return;
        }
        if (!arrivedAt) {
          var marker = currentThreadMarkerFromLocation();
          if (marker === targetMarker || marker !== startMarker || now - startedAt >= 1200) arrivedAt = now;
        }
        if (arrivedAt) {
          var composer = resolveComposerField();
          if (
            composer &&
            (composer !== previous || previousChanged || now - arrivedAt >= 1500) &&
            shouldPullFocusToComposer(document.activeElement, composer, startActive, previous)
          ) {
            focusComposer(composer);
          }
        }
        window.setTimeout(tick, 32);
      }
      tick();
    }
    function scheduleStickMessengerSearchFocus() {
      var delaysMs = [0, 32, 96, 200, 360];
      var k;
      for (k = 0; k < delaysMs.length; k++) {
        window.setTimeout(function () {
          var node = pickMessengerSearchInputAnyStrictness();
          if (!node || document.activeElement === node) return;
          selectInput(node);
        }, delaysMs[k]);
      }
    }
    function threadMarkerFromPath(path) {
      var m = path.match(/\\/t\\/([^/?#]+)/);
      return m ? m[1] : '';
    }
    function currentThreadMarkerFromLocation() {
      return threadMarkerFromPath(window.location.pathname);
    }
    function normalizeThreadHref(href) {
      try {
        return new URL(href, window.location.origin).href;
      } catch (e1) {
        return '';
      }
    }
    function gatherChatSidebarRows() {
      var innerW = window.innerWidth;
      var leftCut = innerW * 0.54;
      var minTop = 48;
      var rows = [];
      var seen =
        typeof WeakSet === 'function'
          ? new WeakSet()
          : {
              _: [],
              has: function (node) {
                return this._.indexOf(node) !== -1;
              },
              add: function (node) {
                this._.push(node);
              },
            };
      var nodes = document.querySelectorAll('[role="row"]');
      var i;
      var el;
      var r;
      for (i = 0; i < nodes.length; i++) {
        el = nodes.item(i);
        if (!(el instanceof HTMLElement)) continue;
        r = el.getBoundingClientRect();
        if (r.right > leftCut || r.left < -2) continue;
        if (r.bottom < minTop || r.height < 14 || r.width < 56) continue;
        if (!el.querySelector('a[href*="/messages/t"]') && !el.querySelector('a[href*="/messages/e2ee/t"]')) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        rows.push(el);
      }
      rows.sort(function (a, b) {
        return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
      });
      return rows;
    }
    function rowSelectionScore(row, threadMarker) {
      var score = 0;
      if (!(row instanceof Element)) return 0;
      if (row.getAttribute('aria-selected') === 'true') score += 4;
      if (row.getAttribute('aria-current') === 'true') score += 4;
      if (row.querySelector('[aria-current="true"]')) score += 3;
      if (typeof row.matches === 'function' && row.matches(':focus-within')) score += 2;
      if (threadMarker) {
        var link = row.querySelector('a[href*="/messages/"]');
        if (link instanceof HTMLAnchorElement) {
          var full = normalizeThreadHref(link.getAttribute('href') || '');
          if (full.indexOf(threadMarker) !== -1) score += 6;
        }
      }
      return score;
    }
    function findActiveChatRowIndex(rows) {
      if (rows.length === 0) return -1;
      var threadMarker = currentThreadMarkerFromLocation();
      var bestIdx = 0;
      var bestScore = -1;
      var i;
      var s;
      for (i = 0; i < rows.length; i++) {
        s = rowSelectionScore(rows[i], threadMarker);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = i;
        }
      }
      if (bestScore >= 2) return bestIdx;
      return 0;
    }
    function findChatRowLink(row) {
      var link = row.querySelector('a[href*="/messages/t"], a[href*="/messages/e2ee/t"]');
      if (!(link instanceof HTMLElement)) {
        link = row.querySelector('a[href*="/messages/"]');
      }
      return link instanceof HTMLElement ? link : null;
    }
    function activateChatRow(row, link) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      var clickEl = link || row.querySelector('[role="link"]');
      if (!(clickEl instanceof HTMLElement)) {
        clickEl = row;
      }
      clickEl.click();
    }
    function activateChatRowAndRefocusComposer(row) {
      var link = findChatRowLink(row);
      var targetMarker = link ? threadMarkerFromPath(link.getAttribute('href') || '') : '';
      focusComposerAfterNavigation(targetMarker, function () {
        activateChatRow(row, link);
      });
    }
    function navigateChatsByAltArrow(delta) {
      var rows = gatherChatSidebarRows();
      if (rows.length === 0) return false;
      var idx = findActiveChatRowIndex(rows);
      var next = idx + delta;
      if (next < 0) next = 0;
      if (next >= rows.length) next = rows.length - 1;
      if (next === idx) return false;
      activateChatRowAndRefocusComposer(rows[next]);
      return true;
    }
    function navigateChatsByIndex(index) {
      var rows = gatherChatSidebarRows();
      if (index < 0 || index >= rows.length) return false;
      activateChatRowAndRefocusComposer(rows[index]);
      return true;
    }
    window.__ownMessengerNavigateChatsByDelta = function (delta) {
      return navigateChatsByAltArrow(delta);
    };
    window.__ownMessengerNavigateChatsByIndex = function (index) {
      return navigateChatsByIndex(index);
    };
    window.__ownMessengerOpenInboxSearch = function () {
      cancelComposerFocus();
      var el = pickMessengerSearchInputAnyStrictness();
      if (!el) return false;
      selectInput(el);
      scheduleStickMessengerSearchFocus();
      return true;
    };
    window.__ownMessengerFocusComposer = function () {
      focusComposerAfterNavigation('', null);
    };
    if (window[NS]) return;
    window[NS] = true;
    window.addEventListener(
      'keydown',
      function (event) {
        var isSearchKey = event.key === 'k' || event.key === 'K';
        var isComposerKey = event.key === 'i' || event.key === 'I';
        if (!isSearchKey && !isComposerKey) return;
        var isMacLike = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
        if (isMacLike) {
          if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
        } else {
          if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        }
        if (event.repeat || event.isComposing) return;
        var action = isSearchKey ? window.__ownMessengerOpenInboxSearch : window.__ownMessengerFocusComposer;
        if (typeof action !== 'function') return;
        action();
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
    window.addEventListener(
      'keydown',
      function (event) {
        if (event.key !== 'Enter' || event.repeat || event.isComposing) return;
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        var active = document.activeElement;
        var targetEl = event.target;
        if (active instanceof HTMLElement && isProbablyMessageComposer(active)) return;
        var fromSearchField = active instanceof HTMLInputElement && isMessengerSearchInput(active);
        var fromResultsRow =
          targetEl instanceof Element && looksLikeSearchPickEnterTarget(targetEl);
        if (!fromSearchField && !fromResultsRow) return;
        window.requestAnimationFrame(function () {
          window.setTimeout(function () {
            focusComposerAfterNavigation('', null);
          }, 0);
        });
      },
      false
    );
    window.addEventListener('pointerdown', cancelComposerFocus, true);
    window.addEventListener(
      'keydown',
      function (event) {
        if (event.key === 'Escape' || event.key === 'Tab') cancelComposerFocus();
      },
      true
    );
    window.addEventListener(
      'keydown',
      function (event) {
        if (event.repeat || event.isComposing) return;
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        var delta = event.key === 'ArrowUp' ? -1 : 1;
        if (typeof window.__ownMessengerNavigateChatsByDelta !== 'function') return;
        if (!window.__ownMessengerNavigateChatsByDelta(delta)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
    window.addEventListener(
      'keydown',
      function (event) {
        if (event.repeat || event.isComposing) return;
        if (event.altKey || event.shiftKey) return;
        if (event.key.length !== 1 || event.key < '1' || event.key > '9') return;
        if (!event.metaKey && !event.ctrlKey) return;
        if (typeof window.__ownMessengerNavigateChatsByIndex !== 'function') return;
        if (!window.__ownMessengerNavigateChatsByIndex(Number(event.key) - 1)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
  })();
`;

const OPEN_MESSENGER_INBOX_SEARCH_SCRIPT =
  INSTALL_MESSENGER_INBOX_SEARCH_HOTKEY_SCRIPT + '\nvoid window.__ownMessengerOpenInboxSearch();';

const FOCUS_MESSENGER_COMPOSER_SCRIPT =
  INSTALL_MESSENGER_INBOX_SEARCH_HOTKEY_SCRIPT + '\nvoid window.__ownMessengerFocusComposer();';

function redirectCmdKFromShellToMessenger(
  event: Electron.Event,
  messengerContents: Electron.WebContents,
): void {
  event.preventDefault();
  messengerContents.focus();
  void messengerContents.executeJavaScript(OPEN_MESSENGER_INBOX_SEARCH_SCRIPT, true).catch(() => undefined);
}

function redirectCmdIFromShellToMessenger(
  event: Electron.Event,
  messengerContents: Electron.WebContents,
): void {
  event.preventDefault();
  messengerContents.focus();
  void messengerContents.executeJavaScript(FOCUS_MESSENGER_COMPOSER_SCRIPT, true).catch(() => undefined);
}

function redirectAltChatNavFromShellToMessenger(
  event: Electron.Event,
  messengerContents: Electron.WebContents,
  delta: number,
): void {
  event.preventDefault();
  messengerContents.focus();
  const script =
    INSTALL_MESSENGER_INBOX_SEARCH_HOTKEY_SCRIPT +
    `\nvoid (typeof window.__ownMessengerNavigateChatsByDelta==="function"?window.__ownMessengerNavigateChatsByDelta(${delta}):0);`;
  void messengerContents.executeJavaScript(script, true).catch(() => undefined);
}

function redirectCmdChatIndexFromShellToMessenger(
  event: Electron.Event,
  messengerContents: Electron.WebContents,
  index: number,
): void {
  event.preventDefault();
  messengerContents.focus();
  const script =
    INSTALL_MESSENGER_INBOX_SEARCH_HOTKEY_SCRIPT +
    `\nvoid (typeof window.__ownMessengerNavigateChatsByIndex==="function"?window.__ownMessengerNavigateChatsByIndex(${index}):0);`;
  void messengerContents.executeJavaScript(script, true).catch(() => undefined);
}

function mainShellShortcutDispatcher(event: Electron.Event, input: Electron.Input): void {
  const messengerContents = messengerShortcutWebContents;
  if (!messengerContents || messengerContents.isDestroyed()) return;
  if (isSearchChatsAccelerator(input)) {
    redirectCmdKFromShellToMessenger(event, messengerContents);
    return;
  }
  if (isFocusComposerAccelerator(input)) {
    redirectCmdIFromShellToMessenger(event, messengerContents);
    return;
  }
  if (isCmdChatIndexAccelerator(input)) {
    redirectCmdChatIndexFromShellToMessenger(event, messengerContents, Number(input.key) - 1);
    return;
  }
  if (isAltChatNavAccelerator(input)) {
    const delta = input.key === 'ArrowUp' ? -1 : 1;
    redirectAltChatNavFromShellToMessenger(event, messengerContents, delta);
  }
}

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

  mainWindow.webContents.on('before-input-event', mainShellShortcutDispatcher);

  mainWindow.webContents.on('did-attach-webview', (_, webContents) => {
    const previousCleanup = messengerGuestDomReadyCleanup;
    if (previousCleanup !== null && !previousCleanup.wc.isDestroyed()) {
      previousCleanup.wc.removeListener('dom-ready', previousCleanup.fn);
    }

    messengerShortcutWebContents = webContents;

    const installHotkeyIntoGuest = (): void => {
      void webContents.executeJavaScript(INSTALL_MESSENGER_INBOX_SEARCH_HOTKEY_SCRIPT, true).catch(() => undefined);
    };
    messengerGuestDomReadyCleanup = { wc: webContents, fn: installHotkeyIntoGuest };
    webContents.removeListener('dom-ready', installHotkeyIntoGuest);
    webContents.on('dom-ready', installHotkeyIntoGuest);

    webContents.setWindowOpenHandler(({ url }) => {
      const isFacebookURL =
        !url ||
        url === 'about:blank' ||
        url.startsWith('https://www.facebook.com') ||
        url.startsWith('https://facebook.com') ||
        url.startsWith('https://www.messenger.com') ||
        url.startsWith('https://messenger.com');
      if (isFacebookURL) {
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
