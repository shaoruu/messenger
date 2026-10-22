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

// Typing ":" and a couple of letters in the composer offers matching emoji, like Slack: arrows or ctrl+n/p move,
// Enter or Tab picks, Escape dismisses, and a full ":name:" is swapped for its emoji as soon as it's closed.
// The preload's listeners run before Facebook's, so the keys it handles never reach the composer.
type EmojiEntry = [emoji: string, names: string, tags: string];
type EmojiMatch = { emoji: string; name: string };
type EmojiQuery = { node: Text; start: number; end: number; text: string };

const EMOJI_QUERY_PATTERN = /(?:^|\s):([a-z0-9_+-]{2,})$/i;
const EMOJI_CLOSED_PATTERN = /(?:^|\s):([a-z0-9_+-]+):$/i;
const EMOJI_MENU_LIMIT = 8;

let emojiEntries: EmojiEntry[] | null = null;
let emojiLoad: Promise<void> | null = null;
let emojiQuery: EmojiQuery | null = null;
let emojiMatches: EmojiMatch[] = [];
let emojiActive = 0;
let emojiDismissed: { node: Text; start: number } | null = null;
let emojiMenu: HTMLElement | null = null;

function loadEmoji(): void {
  emojiLoad ??= ipcRenderer.invoke('emoji-data').then((entries: EmojiEntry[]) => {
    emojiEntries = entries;
    updateEmojiMenu();
  });
}

// Names that start with the query come first, then a word inside a name (":heart" → broken_heart), then
// anywhere in a name, then tags; ties keep gemoji's order.
function searchEmoji(query: string): EmojiMatch[] {
  const q = query.toLowerCase();
  const scored: { match: EmojiMatch; score: number; index: number }[] = [];
  emojiEntries?.forEach(([emoji, names, tags], index) => {
    let best: { name: string; score: number } | null = null;
    for (const name of names.split(' ')) {
      const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes('_' + q) ? 2 : name.includes(q) ? 3 : -1;
      if (score >= 0 && (!best || score < best.score)) best = { name, score };
    }
    if (!best && tags.split(' ').some((tag) => tag.startsWith(q))) best = { name: names.split(' ')[0], score: 4 };
    if (best) scored.push({ match: { emoji, name: best.name }, score: best.score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, EMOJI_MENU_LIMIT).map((s) => s.match);
}

function composerAtCaret(): { node: Text; offset: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !(sel.anchorNode instanceof Text)) return null;
  const editor = sel.anchorNode.parentElement?.closest('[contenteditable="true"][role="textbox"]');
  if (!editor || !editor.closest('[role="main"]')) return null;
  return { node: sel.anchorNode, offset: sel.anchorOffset };
}

function replaceEmojiQuery(query: EmojiQuery, emoji: string): void {
  window.getSelection()?.setBaseAndExtent(query.node, query.start, query.node, query.end);
  document.execCommand('insertText', false, emoji);
}

// The ":query" (or closed ":name:") right before the caret in the composer.
function emojiQueryAtCaret(): { query: EmojiQuery; closed: boolean } | null {
  const caret = composerAtCaret();
  if (!caret) return null;
  const before = caret.node.data.slice(0, caret.offset);
  const closed = before.match(EMOJI_CLOSED_PATTERN);
  const match = closed ?? before.match(EMOJI_QUERY_PATTERN);
  if (!match) return null;
  const length = match[1].length + (closed ? 2 : 1);
  return { query: { node: caret.node, start: caret.offset - length, end: caret.offset, text: match[1] }, closed: !!closed };
}

// Facebook's editor applies a keystroke to the page after the events this listens to, so it looks once the
// frame's changes have landed.
let emojiUpdateFrame = 0;
function scheduleEmojiUpdate(): void {
  if (!emojiUpdateFrame) emojiUpdateFrame = requestAnimationFrame(updateEmojiMenu);
}

function updateEmojiMenu(): void {
  emojiUpdateFrame = 0;
  const found = emojiQueryAtCaret();
  if (found && !emojiEntries) {
    loadEmoji();
    return;
  }
  if (found?.closed) {
    const name = found.query.text.toLowerCase();
    const entry = emojiEntries!.find(([, names]) => names.split(' ').includes(name));
    closeEmojiMenu();
    if (entry) replaceEmojiQuery(found.query, entry[0]);
    return;
  }
  if (!found) {
    emojiDismissed = null;
    closeEmojiMenu();
    return;
  }
  const { query } = found;
  if (emojiDismissed && emojiDismissed.node === query.node && emojiDismissed.start === query.start) return;
  const changed = !emojiQuery || emojiQuery.text !== query.text;
  emojiQuery = query;
  emojiMatches = searchEmoji(query.text);
  if (changed) emojiActive = 0;
  if (emojiMatches.length === 0) {
    closeEmojiMenu();
    return;
  }
  renderEmojiMenu();
}

function renderEmojiMenu(): void {
  if (!emojiQuery) return;
  if (!emojiMenu) {
    emojiMenu = document.createElement('div');
    emojiMenu.id = 'own-messenger-emoji-menu';
    emojiMenu.setAttribute('role', 'listbox');
    // Keep focus (and the caret) in the composer.
    emojiMenu.addEventListener('mousedown', (event) => event.preventDefault());
  }
  if (!emojiMenu.isConnected) document.body.appendChild(emojiMenu);
  emojiMenu.replaceChildren(
    ...emojiMatches.map((match, index) => {
      const item = document.createElement('div');
      item.className = 'own-messenger-emoji-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === emojiActive));
      const glyph = document.createElement('span');
      glyph.className = 'own-messenger-emoji-glyph';
      glyph.textContent = match.emoji;
      const name = document.createElement('span');
      name.textContent = ':' + match.name + ':';
      item.append(glyph, name);
      item.addEventListener('mousemove', () => {
        if (emojiActive === index) return;
        emojiActive = index;
        renderEmojiMenu();
      });
      item.addEventListener('click', () => pickEmoji(index));
      return item;
    }),
  );
  const range = document.createRange();
  range.setStart(emojiQuery.node, emojiQuery.start);
  range.setEnd(emojiQuery.node, emojiQuery.start + 1);
  const anchor = range.getBoundingClientRect();
  const width = emojiMenu.offsetWidth;
  emojiMenu.style.left = Math.max(8, Math.min(anchor.left - 8, window.innerWidth - width - 8)) + 'px';
  emojiMenu.style.bottom = window.innerHeight - anchor.top + 8 + 'px';
}

function closeEmojiMenu(): void {
  emojiQuery = null;
  emojiMatches = [];
  emojiMenu?.remove();
}

// Typing can be a frame ahead of the menu, so the text to replace is read again.
function pickEmoji(index: number): void {
  const match = emojiMatches[index];
  const found = emojiQueryAtCaret();
  closeEmojiMenu();
  if (match && found) replaceEmojiQuery(found.query, match.emoji);
}

webFrame.insertCSS(
  `#own-messenger-emoji-menu {
    position: fixed; z-index: 2147483647; min-width: 240px; max-width: 360px; padding: 6px;
    background: var(--card-background, #242526); color: var(--primary-text, #e4e6eb);
    border: 1px solid var(--divider, #3e4042); border-radius: 10px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
    font: 15px/20px system-ui, -apple-system, sans-serif; }
  .own-messenger-emoji-item {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .own-messenger-emoji-item[aria-selected="true"] { background: var(--hover-overlay, rgba(255, 255, 255, 0.1)); }
  .own-messenger-emoji-glyph { font-size: 20px; width: 24px; text-align: center; }`,
  { cssOrigin: 'user' },
);

document.addEventListener('selectionchange', scheduleEmojiUpdate);
document.addEventListener('input', scheduleEmojiUpdate, true);
window.addEventListener('blur', closeEmojiMenu);
window.addEventListener('resize', closeEmojiMenu);
window.addEventListener(
  'keydown',
  (event) => {
    if (!emojiQuery || emojiMatches.length === 0 || event.isComposing) return;
    const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    let handled = true;
    if ((plain && event.key === 'ArrowDown') || (ctrlOnly && event.key === 'n')) {
      emojiActive = (emojiActive + 1) % emojiMatches.length;
      renderEmojiMenu();
    } else if ((plain && event.key === 'ArrowUp') || (ctrlOnly && event.key === 'p')) {
      emojiActive = (emojiActive - 1 + emojiMatches.length) % emojiMatches.length;
      renderEmojiMenu();
    } else if (plain && (event.key === 'Enter' || event.key === 'Tab')) {
      pickEmoji(emojiActive);
    } else if (plain && event.key === 'Escape') {
      emojiDismissed = { node: emojiQuery.node, start: emojiQuery.start };
      closeEmojiMenu();
    } else {
      handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
