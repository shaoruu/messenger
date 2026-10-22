import { app, BrowserWindow, session, ipcMain, shell, clipboard, Menu, desktopCapturer } from 'electron';
import * as fs from 'fs';
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

function isToggleSidebarAccelerator(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.isAutoRepeat || input.isComposing) return false;
  if (!(input.meta || input.control)) return false;
  if (input.alt || input.shift) return false;
  const key = input.key.toLowerCase();
  return key === 'b' || key === 's';
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
    // The chat list's right edge, which moves when the sidebar is resized.
    function leftPaneRight(fallbackFraction) {
      var sidebar = document.querySelector('[data-own-messenger-sidebar]');
      var r = sidebar ? sidebar.getBoundingClientRect() : null;
      return r && r.width > 0 ? r.right + 2 : window.innerWidth * fallbackFraction;
    }
    function looksLikeLeftPaneInteractive(el) {
      if (!(el instanceof Element)) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.right < leftPaneRight(0.6);
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
      var leftCut = leftPaneRight(0.54);
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
      if (typeof window.__ownMessengerShowSidebar === 'function') window.__ownMessengerShowSidebar();
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
    // Typing while nothing editable is focused goes to the composer. Focusing it during keydown makes the
    // browser insert this same keystroke there, so the first character isn't lost.
    window.addEventListener(
      'keydown',
      function (event) {
        if (event.isComposing || event.defaultPrevented) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key.length !== 1 || event.key === ' ') return;
        var active = document.activeElement;
        if (isEditableElement(active)) return;
        if (active instanceof Element && active.closest('[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"]')) {
          return;
        }
        var composer = resolveComposerField();
        if (!composer) return;
        cancelComposerFocus();
        focusComposer(composer);
      },
      true
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

const SIDEBAR_STATE_MESSAGE_PREFIX = '__ownMessengerSidebarState:';

// Facebook's class names are obfuscated, so the chat list column is found by climbing from a chat link to
// the widest ancestor that is still narrower than its parent (the row that also holds the open thread).
const INSTALL_MESSENGER_SIDEBAR_SCRIPT = `
  void (function () {
    var NS = '__ownMessengerSidebar';
    if (window[NS]) return;
    window[NS] = true;
    var MARK = 'data-own-messenger-sidebar';
    var FILL = 'data-own-messenger-sidebar-fill';
    var SIZED = 'own-messenger-sidebar-sized';
    var HIDDEN = 'own-messenger-sidebar-hidden';
    var RESIZING = 'own-messenger-sidebar-resizing';
    var MIN_WIDTH = 200;
    var MAX_FRACTION = 0.6;
    var column = null;
    var naturalWidth = 0;
    var saved = window.__ownMessengerSidebarSavedState || {};
    var state = { width: saved.width || 0, hidden: saved.hidden === true };
    // Facebook's localStorage isn't ours to keep things in, so the app stores the state (see SIDEBAR_STATE_MESSAGE_PREFIX).
    function saveState() {
      console.debug('${SIDEBAR_STATE_MESSAGE_PREFIX}' + JSON.stringify(state));
    }
    function clampWidth(width) {
      return Math.round(Math.max(MIN_WIDTH, Math.min(width, window.innerWidth * MAX_FRACTION)));
    }
    function findColumn() {
      var innerW = window.innerWidth;
      var innerH = window.innerHeight;
      var links = document.querySelectorAll('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]');
      var i;
      var node;
      var parent;
      var r;
      for (i = 0; i < links.length; i++) {
        node = links.item(i);
        r = node.getBoundingClientRect();
        if (r.width === 0 || r.left > innerW * 0.4) continue;
        while ((parent = node.parentElement) && parent !== document.body) {
          if (parent.getBoundingClientRect().width > node.getBoundingClientRect().width + 100) break;
          node = parent;
        }
        r = node.getBoundingClientRect();
        if (r.width < innerW * 0.7 && r.left < innerW * 0.3 && r.height > innerH * 0.4) return node;
      }
      return null;
    }
    // Wrappers inside the column can carry the same fixed width; they need to follow the column's.
    function markFillDescendants() {
      if (!column || !naturalWidth) return;
      var level = [column];
      var depth;
      var next;
      var i;
      var j;
      var child;
      for (depth = 0; depth < 6 && level.length; depth++) {
        next = [];
        for (i = 0; i < level.length; i++) {
          for (j = 0; j < level[i].children.length; j++) {
            child = level[i].children[j];
            if (Math.abs(child.getBoundingClientRect().width - naturalWidth) < 1) child.setAttribute(FILL, '');
            next.push(child);
          }
        }
        level = next;
      }
    }
    var style = document.createElement('style');
    style.textContent = [
      'html.' + SIZED + ' [' + MARK + '] { width: var(--own-messenger-sidebar-width) !important;',
      '  min-width: var(--own-messenger-sidebar-width) !important; max-width: var(--own-messenger-sidebar-width) !important;',
      '  flex: 0 0 var(--own-messenger-sidebar-width) !important; }',
      'html.' + SIZED + ' [' + FILL + '] { box-sizing: border-box !important; width: 100% !important; min-width: 0 !important;',
      '  max-width: none !important; }',
      'html.' + HIDDEN + ' [' + MARK + '] { display: none !important; }',
      'html.' + RESIZING + ', html.' + RESIZING + ' * { cursor: col-resize !important; user-select: none !important; }',
      '#own-messenger-sidebar-handle { position: fixed; z-index: 2147483647; width: 8px; cursor: col-resize; display: none; }',
      '#own-messenger-sidebar-handle::after { content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px;',
      '  background: #0866ff; opacity: 0; transition: opacity 0.15s; }',
      '#own-messenger-sidebar-handle:hover::after, html.' + RESIZING + ' #own-messenger-sidebar-handle::after { opacity: 1; transition-delay: 0.1s; }',
    ].join('\\n');
    var handle = document.createElement('div');
    handle.id = 'own-messenger-sidebar-handle';
    handle.title = 'Drag to resize, double-click to reset';
    function apply() {
      var root = document.documentElement;
      if (!style.isConnected) (document.head || root).appendChild(style);
      if (!handle.isConnected && document.body) document.body.appendChild(handle);
      root.classList.toggle(HIDDEN, state.hidden);
      root.classList.toggle(SIZED, state.width > 0);
      if (state.width > 0) root.style.setProperty('--own-messenger-sidebar-width', clampWidth(state.width) + 'px');
      var r = column && !state.hidden ? column.getBoundingClientRect() : null;
      if (!r || r.width === 0) {
        handle.style.display = 'none';
        return;
      }
      handle.style.display = 'block';
      handle.style.left = r.right - 4 + 'px';
      handle.style.top = r.top + 'px';
      handle.style.height = r.height + 'px';
    }
    function sync() {
      if (!column || !column.isConnected) {
        if (column) column.removeAttribute(MARK);
        column = findColumn();
        if (column) {
          naturalWidth = column.getBoundingClientRect().width;
          column.setAttribute(MARK, '');
        }
      }
      markFillDescendants();
      apply();
    }
    function setHidden(hidden) {
      state.hidden = hidden;
      saveState();
      sync();
    }
    window.__ownMessengerToggleSidebar = function () {
      setHidden(!state.hidden);
    };
    window.__ownMessengerShowSidebar = function () {
      if (state.hidden) setHidden(false);
    };
    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || !column) return;
      event.preventDefault();
      var left = column.getBoundingClientRect().left;
      handle.setPointerCapture(event.pointerId);
      document.documentElement.classList.add(RESIZING);
      function move(moveEvent) {
        state.width = clampWidth(moveEvent.clientX - left);
        apply();
      }
      function end() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        handle.removeEventListener('lostpointercapture', end);
        document.documentElement.classList.remove(RESIZING);
        saveState();
        window.dispatchEvent(new Event('resize'));
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('lostpointercapture', end);
    });
    handle.addEventListener('dblclick', function () {
      state.width = 0;
      saveState();
      apply();
    });
    window.addEventListener(
      'keydown',
      function (event) {
        var key = event.key.toLowerCase();
        if (key !== 'b' && key !== 's') return;
        var isMacLike = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
        if (isMacLike) {
          if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
        } else {
          if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        }
        if (event.isComposing) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) window.__ownMessengerToggleSidebar();
      },
      true
    );
    window.addEventListener('resize', apply);
    window.setInterval(sync, 500);
    sync();
  })();
`;

type SidebarState = { width: number; hidden: boolean };

function sidebarStatePath(): string {
  return path.join(app.getPath('userData'), 'sidebar.json');
}

function loadSidebarState(): SidebarState {
  try {
    const saved = JSON.parse(fs.readFileSync(sidebarStatePath(), 'utf8'));
    return { width: typeof saved.width === 'number' ? saved.width : 0, hidden: saved.hidden === true };
  } catch {
    return { width: 0, hidden: false };
  }
}

function saveSidebarStateFromGuest(message: string): void {
  if (!message.startsWith(SIDEBAR_STATE_MESSAGE_PREFIX)) return;
  try {
    const reported = JSON.parse(message.slice(SIDEBAR_STATE_MESSAGE_PREFIX.length));
    if (typeof reported.width !== 'number' || typeof reported.hidden !== 'boolean') return;
    const state: SidebarState = { width: Math.max(0, Math.round(reported.width)), hidden: reported.hidden };
    fs.writeFileSync(sidebarStatePath(), JSON.stringify(state));
  } catch (error) {
    console.error('Could not save the sidebar state', error);
  }
}

function installMessengerSidebarScript(): string {
  return `window.__ownMessengerSidebarSavedState = ${JSON.stringify(loadSidebarState())};\n` + INSTALL_MESSENGER_SIDEBAR_SCRIPT;
}

// The guest is a messenger-only window, so Facebook's own site header goes; its layout is sized off --header-height.
const HIDE_FACEBOOK_BANNER_CSS = `
  :root, html, body, .__fb-dark-mode, .__fb-light-mode { --header-height: 0px !important; }
  [role="banner"] { display: none !important; }
`;

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

function toggleMessengerSidebar(messengerContents: Electron.WebContents): void {
  const script = installMessengerSidebarScript() + '\nvoid window.__ownMessengerToggleSidebar();';
  void messengerContents.executeJavaScript(script, true).catch(() => undefined);
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
  if (isToggleSidebarAccelerator(input)) {
    event.preventDefault();
    toggleMessengerSidebar(messengerContents);
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

// macOS Tahoe only draws the larger corner radius native apps have on windows with a
// toolbar, and no titleBarStyle adds one anymore (see src/native/window-chrome.m).
function attachEmptyToolbar(window: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  const addonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'window-chrome.node')
    : path.join(__dirname, '..', 'dist-native', 'window-chrome.node');
  try {
    require(addonPath).attachEmptyToolbar(window.getNativeWindowHandle());
    // AppKit re-centers the traffic lights in the toolbar; put them back in the nav bar.
    const buttonPosition = window.getWindowButtonPosition();
    window.setWindowButtonPosition(buttonPosition);
    // The toolbar comes back on leaving fullscreen and re-centers them again.
    window.on('leave-full-screen', () => window.setWindowButtonPosition(buttonPosition));
  } catch (error) {
    console.error('Could not attach the window toolbar', error);
  }
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
    // Shown wherever the page hasn't painted yet, like the strip a resize exposes.
    backgroundColor: '#242526',
  });
  attachEmptyToolbar(mainWindow);
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('full-screen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('full-screen-changed', false));

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
      void webContents.executeJavaScript(installMessengerSidebarScript(), true).catch(() => undefined);
      void webContents.insertCSS(HIDE_FACEBOOK_BANNER_CSS).catch(() => undefined);
    };
    messengerGuestDomReadyCleanup = { wc: webContents, fn: installHotkeyIntoGuest };
    webContents.removeListener('dom-ready', installHotkeyIntoGuest);
    webContents.on('dom-ready', installHotkeyIntoGuest);

    webContents.on('console-message', (event) => saveSidebarStateFromGuest(event.message));

    webContents.on('context-menu', (_event, params) => {
      showGuestContextMenu(mainWindow, webContents, params);
    });

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

function showGuestContextMenu(
  window: BrowserWindow,
  webContents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): void {
  const template: Electron.MenuItemConstructorOptions[] = [];
  const addSection = (items: Electron.MenuItemConstructorOptions[]): void => {
    if (items.length === 0) return;
    if (template.length > 0) template.push({ type: 'separator' });
    template.push(...items);
  };

  if (params.mediaType === 'image' && params.srcURL) {
    addSection([
      { label: 'Copy Image', click: () => webContents.copyImageAt(params.x, params.y) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
      { label: 'Save Image As…', click: () => webContents.downloadURL(params.srcURL) },
    ]);
  }

  if (params.linkURL) {
    addSection([
      { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
      { label: 'Open in Browser', click: () => shell.openExternal(params.linkURL) },
    ]);
  }

  if (params.isEditable) {
    addSection([
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) {
    addSection([{ role: 'copy' }]);
  }

  if (template.length === 0) return;
  Menu.buildFromTemplate(template).popup({ window });
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

ipcMain.on('toggle-sidebar', () => {
  const messengerContents = messengerShortcutWebContents;
  if (!messengerContents || messengerContents.isDestroyed()) return;
  toggleMessengerSidebar(messengerContents);
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
