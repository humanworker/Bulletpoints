import '@fontsource-variable/inter';
import './style.css';
import { LOCAL_ONLY } from './flags';
import { Store, Undo } from './store';
import { cleanEditedHtml, htmlToPlain, linkify, plainToHtml } from './text';
import { haptic, hideSplash, onAppResume, onBackButton, onKeyboardHidden, openUrl, syncSystemBars } from './native';

// Point has no buttons. A list is a stack of lines, and everything is done to the lines directly:
//
//   tap a line            edit it (or open it, if it has things inside)
//   tap the right edge    open any line, to put things inside it
//   swipe right / left    complete / delete
//   pull down             new line at the top; keep pulling to go up a level
//   tap below the list    new line at the end
//   pinch apart           new line between two others; pinch together to go up a level
//   hold                  pick a line up: move it, slide right to tuck it into the line above,
//                         slide left to move it out a level
//   pull up at the bottom clear what's completed

const store = new Store();
if (LOCAL_ONLY) (window as unknown as { __point: unknown }).__point = { store }; // for tests against the sample outline
const app = document.getElementById('app')!;

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const ROW_H = 56;
const EDGE_ZONE = 60;
const SWIPE_ARM = 76;
const HOLD_MS = 330;
const NEST_ARM = 60;
const LOCATION_KEY = 'point-location';

const ICON_CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 7"/></svg>';
const ICON_CROSS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_BACK = '<svg width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 1.5l-5 5 5 5"/></svg>';
const ICON_UP = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 11.5v-10M2 6l4.5-4.5L11 6"/></svg>';

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const setY = (el: HTMLElement, y: number): void => {
  el.style.transform = y ? `translate3d(0,${y}px,0)` : '';
};
const qs = (root: Element, selector: string): HTMLElement => root.querySelector(selector) as HTMLElement;

// ------------------------------------------------------------------- screens

const htmlCache = new WeakMap<HTMLElement, string>();

const setHtml = (el: HTMLElement, html: string): void => {
  if (htmlCache.get(el) === html) return;
  el.innerHTML = html;
  htmlCache.set(el, html);
};

const makeRow = (): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML =
    `<div class="under"><i class="u-l">${ICON_CHECK}</i><i class="u-r">${ICON_CROSS}</i></div>` +
    '<div class="face"><div class="text" dir="auto"></div><div class="count"></div></div>';
  wireEditor(qs(row, '.text'));
  return row;
};

class Screen {
  el = document.createElement('section');
  scroller: HTMLElement;
  content: HTMLElement;
  head: HTMLElement;
  crumb: HTMLElement;
  title: HTMLElement;
  upHint: HTMLElement;
  list: HTMLElement;
  ghost: HTMLElement;
  rows: HTMLElement;
  tail: HTMLElement;
  clearHint: HTMLElement;
  rowEls = new Map<string, HTMLElement>();
  draft: { row: HTMLElement; beforeId: string | null } | null = null;

  constructor(public nodeId: string) {
    this.el.className = 'screen';
    this.el.innerHTML =
      '<div class="scroller"><div class="content">' +
      `<header class="head"><div class="crumb">${ICON_BACK}<span></span></div><h1 class="title" dir="auto"></h1>` +
      `<div class="uphint">${ICON_UP}<span></span></div></header>` +
      '<div class="list"><div class="ghost">New item</div><div class="rows"></div>' +
      '<div class="tail"><div class="empty">Pull down to add</div></div></div>' +
      '</div></div><div class="clearhint"></div>';
    this.scroller = qs(this.el, '.scroller');
    this.content = qs(this.el, '.content');
    this.head = qs(this.el, '.head');
    this.crumb = qs(this.el, '.crumb');
    this.title = qs(this.el, '.title');
    this.upHint = qs(this.el, '.uphint');
    this.list = qs(this.el, '.list');
    this.ghost = qs(this.el, '.ghost');
    this.rows = qs(this.el, '.rows');
    this.tail = qs(this.el, '.tail');
    this.clearHint = qs(this.el, '.clearhint');
    wireEditor(this.title);
  }

  /** Rows that can be moved and inserted between: the open ones, in order */
  openRows(): HTMLElement[] {
    return (Array.from(this.rows.children) as HTMLElement[]).filter((r) => r.dataset.id && !r.classList.contains('done'));
  }

  /**
   * Bring the DOM in line with the data. When animating, every line glides from wherever it is on
   * screen right now (including mid-gesture offsets) to where it belongs.
   */
  render(animate = false, seed?: Map<Element, number>): void {
    const item = store.items[this.nodeId];
    if (!item) return;
    const parentId = store.parentOf(this.nodeId);
    const parentName = parentId ? htmlToPlain(store.items[parentId].text) || 'Back' : '';
    this.el.classList.toggle('is-root', !parentId);
    if (editing?.el !== this.title) setHtml(this.title, item.text);
    qs(this.crumb, 'span').textContent = parentName;
    qs(this.upHint, 'span').textContent = parentName;

    const tracked = [this.head, ...(Array.from(this.rows.children) as HTMLElement[]), this.tail];
    const before = new Map<Element, number>();
    if (animate) for (const el of tracked) before.set(el, el.getBoundingClientRect().top);
    seed?.forEach((top, el) => before.set(el, top));

    // Gestures leave their offsets in place; from here on the layout is the truth
    for (const el of tracked) {
      el.getAnimations().forEach((a) => a.cancel());
      el.style.transform = '';
    }
    this.list.style.transform = '';
    this.content.style.transform = '';
    this.content.style.opacity = '';
    this.ghost.style.display = 'none';
    this.ghost.classList.remove('armed');
    this.upHint.style.opacity = '';
    this.upHint.classList.remove('armed');
    this.clearHint.style.opacity = '';
    this.clearHint.classList.remove('armed');

    const ids = store.display(this.nodeId);
    const openN = store.openCount(this.nodeId);
    const desired: HTMLElement[] = [];
    ids.forEach((id, i) => {
      let row = this.rowEls.get(id);
      if (!row) {
        row = makeRow();
        row.dataset.id = id;
        this.rowEls.set(id, row);
      }
      this.updateRow(row, id, i < openN ? i : 0);
      desired.push(row);
    });
    for (const id of Array.from(this.rowEls.keys())) {
      if (!ids.includes(id)) this.rowEls.delete(id);
    }
    if (this.draft) {
      let at = this.draft.beforeId ? ids.indexOf(this.draft.beforeId) : -1;
      if (at < 0) at = openN;
      this.draft.row.style.setProperty('--i', String(at));
      desired.splice(at, 0, this.draft.row);
    }

    const keep = new Set(desired);
    for (const child of Array.from(this.rows.children) as HTMLElement[]) {
      if (keep.has(child)) continue;
      if (animate) this.floatOut(child, before.get(child));
      else child.remove();
    }
    desired.forEach((row, i) => {
      if (this.rows.children[i] !== row) this.rows.insertBefore(row, this.rows.children[i] ?? null);
    });
    this.el.classList.toggle('is-empty', desired.length === 0);

    if (!animate) return;
    for (const el of [this.head, ...desired, this.tail]) {
      const from = before.get(el);
      if (from === undefined) {
        el.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: EASE });
        continue;
      }
      const delta = from - el.getBoundingClientRect().top;
      if (Math.abs(delta) > 0.5) {
        el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 320, easing: EASE });
      }
    }
  }

  private updateRow(row: HTMLElement, id: string, openIndex: number): void {
    const item = store.items[id];
    const hasChildren = item.children.some((c) => store.items[c]);
    row.classList.toggle('done', !!item.isCompleted);
    row.classList.toggle('parent', hasChildren);
    row.style.setProperty('--i', String(openIndex));
    const text = qs(row, '.text');
    if (editing?.el !== text) setHtml(text, item.text);
    const open = store.openCount(id);
    qs(row, '.count').textContent = hasChildren ? (open ? String(open) : '✓') : '';
  }

  /** Lift an element out of the flow where it stands and let it fade away */
  floatOut(el: HTMLElement, visualTop?: number, to: Keyframe = { opacity: 0, transform: 'scale(0.96)' }, duration = 200): void {
    const top = (visualTop ?? el.getBoundingClientRect().top) - this.list.getBoundingClientRect().top;
    el.getAnimations().forEach((a) => a.cancel());
    el.classList.add('floating');
    el.style.transform = '';
    el.style.top = `${top}px`;
    this.list.appendChild(el);
    const done = () => el.remove();
    const anim = el.animate([{ opacity: 1, transform: 'none' }, to], { duration, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = done;
    anim.oncancel = done;
  }

  flash(id: string): void {
    const row = this.rowEls.get(id);
    if (!row) return;
    row.classList.remove('came-from');
    void row.offsetWidth;
    row.classList.add('came-from');
  }
}

// ---------------------------------------------------------------- navigation

let current: Screen;
let path: string[] = [];
let transitioning = false;
let booted = false;
const scrollMemo = new Map<string, number>();

const show = (nodeId: string, dir: 1 | -1 | 0): void => {
  const prev: Screen | undefined = current;
  if (prev) scrollMemo.set(prev.nodeId, prev.scroller.scrollTop);
  const next = new Screen(nodeId);
  next.render(false);
  if (dir === -1 && prev) app.insertBefore(next.el, prev.el);
  else app.appendChild(next.el);
  if (dir !== 1) next.scroller.scrollTop = scrollMemo.get(nodeId) ?? 0;
  current = next;
  try {
    localStorage.setItem(LOCATION_KEY, nodeId);
  } catch {
    /* location just won't be remembered */
  }
  if (!prev) return;
  if (dir === 0) {
    prev.el.remove();
    return;
  }

  transitioning = true;
  const timing = { duration: 340, easing: EASE, fill: 'both' as const };
  const leaving =
    dir === 1
      ? prev.el.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate3d(-26%,0,0)', opacity: 0 }], timing)
      : prev.el.animate([{ transform: 'none' }, { transform: 'translate3d(100%,0,0)' }], timing);
  if (dir === 1) next.el.animate([{ transform: 'translate3d(100%,0,0)' }, { transform: 'none' }], timing);
  else next.el.animate([{ transform: 'translate3d(-26%,0,0)', opacity: 0 }, { transform: 'none', opacity: 1 }], timing);
  const done = () => {
    prev.el.remove();
    next.el.getAnimations().forEach((a) => a.cancel());
    transitioning = false;
  };
  leaving.onfinish = done;
  leaving.oncancel = done;
};

const drill = (id: string): void => {
  if (transitioning || !store.items[id]) return;
  path.push(id);
  show(id, 1);
};

const goUp = (): boolean => {
  if (transitioning || path.length < 2) return false;
  const from = path.pop()!;
  show(path[path.length - 1], -1);
  current.rowEls.get(from)?.scrollIntoView({ block: 'nearest' });
  current.flash(from);
  return true;
};

/** After any data change: if the list on screen was moved or deleted, follow it or fall back */
const syncNavigation = (): void => {
  const valid = store.pathTo(current.nodeId);
  if (valid) {
    path = valid;
    return;
  }
  let fallback = store.rootId;
  for (let i = path.length - 1; i >= 0; i--) {
    if (store.pathTo(path[i])) {
      fallback = path[i];
      break;
    }
  }
  if (editing) finishEdit('cancel');
  path = store.pathTo(fallback) || [store.rootId];
  show(path[path.length - 1], 0);
};

// --------------------------------------------------------- changes + toasts

let renderLock = 0;
let renderQueued = false;

/** Run a local change, then redraw once (the store's own change event is ignored meanwhile) */
const mutate = (fn: () => void, animate: boolean, seed?: Map<Element, number>): void => {
  renderLock++;
  try {
    fn();
  } finally {
    renderLock--;
  }
  syncNavigation();
  current.render(animate, seed);
};

const toastEl = document.getElementById('toast')!;
const toastMsg = qs(toastEl, '.toast-msg');
const toastUndo = qs(toastEl, '.toast-undo');
let toastTimer = 0;
let pendingUndo: Undo | null = null;

const hideToast = (): void => {
  toastEl.classList.remove('show');
  pendingUndo = null;
};

const toast = (message: string, undo: Undo | null): void => {
  toastMsg.textContent = message;
  pendingUndo = undo;
  toastUndo.style.display = undo ? '' : 'none';
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 4500);
};

toastUndo.addEventListener('click', () => {
  const undo = pendingUndo;
  hideToast();
  if (!undo) return;
  haptic('light');
  mutate(undo, true);
});

const removeItem = (id: string): void => {
  if (!store.items[id]) return;
  const inside = store.subtreeSize(id) - 1;
  let undo: Undo | null = null;
  mutate(() => {
    undo = store.remove(id);
  }, true);
  toast(inside > 0 ? `Deleted, with ${inside} inside` : 'Deleted', undo);
};

const clearCompleted = (): void => {
  const n = store.doneCount(current.nodeId);
  let undo: Undo | null = null;
  mutate(() => {
    undo = store.clearCompleted(current.nodeId);
  }, true);
  if (undo) toast(`Cleared ${n}`, undo);
};

// ------------------------------------------------------------------- editing

interface Edit {
  kind: 'item' | 'draft' | 'title';
  el: HTMLElement;
  row: HTMLElement | null;
  screen: Screen;
  id: string | null;
  beforeId: string | null;
  original: string;
}

let editing: Edit | null = null;

const placeCaret = (el: HTMLElement, point?: { x: number; y: number }): void => {
  const selection = window.getSelection();
  if (!selection) return;
  let range: Range | null = null;
  if (point && document.caretRangeFromPoint) range = document.caretRangeFromPoint(point.x, point.y);
  if (!range || !el.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
};

const keepEditorVisible = (): void => {
  requestAnimationFrame(() => {
    if (editing) (editing.row ?? editing.el).scrollIntoView({ block: 'nearest' });
  });
};

const beginEdit = (edit: Edit, point?: { x: number; y: number }): void => {
  if (editing) finishEdit('blur');
  editing = edit;
  const { el } = edit;
  el.contentEditable = 'true';
  el.setAttribute('enterkeyhint', edit.kind === 'draft' ? 'next' : 'done');
  el.setAttribute('autocapitalize', 'sentences');
  edit.screen.el.classList.add('editing');
  (edit.row ?? el).classList.add('is-editing');
  el.focus({ preventScroll: true });
  placeCaret(el, point);
  keepEditorVisible();
};

const startDraft = (beforeId: string | null, fromTop?: number): void => {
  if (editing) finishEdit('blur');
  const screen = current;
  const row = makeRow();
  row.dataset.draft = '1';
  screen.draft = { row, beforeId };
  screen.render(true, fromTop === undefined ? undefined : new Map([[row, fromTop]]));
  beginEdit({ kind: 'draft', el: qs(row, '.text'), row, screen, id: null, beforeId, original: '' });
};

const editItem = (row: HTMLElement, id: string, x: number, y: number): void => {
  beginEdit({ kind: 'item', el: qs(row, '.text'), row, screen: current, id, beforeId: null, original: store.items[id].text }, { x, y });
};

const editTitle = (x: number, y: number): void => {
  const screen = current;
  beginEdit({ kind: 'title', el: screen.title, row: null, screen, id: screen.nodeId, beforeId: null, original: store.items[screen.nodeId].text }, { x, y });
};

const finishEdit = (reason: 'enter' | 'blur' | 'cancel'): void => {
  const edit = editing;
  if (!edit) return;
  editing = null;
  const { el, screen, row } = edit;
  const html = reason === 'cancel' ? (edit.kind === 'draft' ? '' : edit.original) : cleanEditedHtml(el.innerHTML);
  let keepTyping = false;

  screen.el.classList.remove('editing');
  (row ?? el).classList.remove('is-editing');

  if (edit.kind === 'draft' && row) {
    // A draft only becomes a real item once it has words in it
    const lines = el.innerText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    screen.draft = null;
    if (!html || reason === 'cancel') {
      if (screen === current) screen.render(true);
      else row.remove();
    } else {
      const texts = lines.length > 1 ? lines.map((line) => linkify(plainToHtml(line))) : [html];
      mutate(() => {
        texts.forEach((text, i) => {
          const id = store.add(screen.nodeId, edit.beforeId, text);
          if (i === 0 && id) {
            row.dataset.id = id;
            delete row.dataset.draft;
            screen.rowEls.set(id, row);
            htmlCache.delete(el);
          }
        });
      }, texts.length > 1);
      keepTyping = reason === 'enter' && screen === current;
    }
  } else if (edit.id && store.items[edit.id]) {
    const item = store.items[edit.id];
    htmlCache.delete(el);
    if (html) {
      setHtml(el, html);
      mutate(() => store.setText(edit.id!, html), false);
    } else if (edit.kind === 'item' && item.children.length === 0) {
      // Emptying a line deletes it
      setHtml(el, edit.original);
      removeItem(edit.id);
    } else {
      setHtml(el, edit.original);
    }
  }

  // Enter on a new line starts the next one. Focus moves first, so the keyboard never drops.
  if (keepTyping) startDraft(edit.beforeId);
  el.contentEditable = 'false';
  el.removeAttribute('contenteditable');
  if (document.activeElement === el) el.blur();
  if (!keepTyping) window.getSelection()?.removeAllRanges();
};

function wireEditor(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => {
    if (editing?.el !== el) return;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      finishEdit('enter');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit('cancel');
    }
  });
  // Phone keyboards often report Enter and Backspace only through beforeinput
  el.addEventListener('beforeinput', (e) => {
    if (editing?.el !== el) return;
    const type = e.inputType;
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      e.preventDefault();
      finishEdit('enter');
    } else if (type === 'deleteContentBackward' && editing.kind === 'draft' && el.textContent === '') {
      e.preventDefault();
      finishEdit('cancel');
    } else if (type.startsWith('format')) {
      e.preventDefault();
    }
  });
  el.addEventListener('paste', (e) => {
    if (editing?.el !== el) return;
    e.preventDefault();
    let text = e.clipboardData?.getData('text/plain') ?? '';
    // Pasting several lines into a new line makes several items; anywhere else they join up
    if (editing.kind !== 'draft') text = text.replace(/\s*[\r\n]+\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('blur', () => {
    if (editing?.el === el) finishEdit('blur');
  });
}

window.addEventListener('resize', keepEditorVisible);
window.visualViewport?.addEventListener('resize', keepEditorVisible);
onKeyboardHidden(() => {
  if (editing) finishEdit('blur');
});

// ------------------------------------------------------------------ gestures

type Mode = 'idle' | 'pending' | 'scroll' | 'swipe' | 'pull' | 'pullup' | 'drag' | 'pinch' | 'dismiss' | 'native' | 'spent';

const g = {
  mode: 'idle' as Mode,
  id: -1,
  x0: 0,
  y0: 0,
  x: 0,
  y: 0,
  vx: 0,
  lastT: 0,
  target: null as HTMLElement | null,
  row: null as HTMLElement | null,
  timer: 0,
};

let lastScrollAt = -1000;
app.addEventListener('scroll', () => {
  lastScrollAt = performance.now();
}, { capture: true, passive: true });

const isGesturing = (): boolean => g.mode === 'swipe' || g.mode === 'pull' || g.mode === 'pullup' || g.mode === 'drag' || g.mode === 'pinch';

const findTouch = (list: TouchList, id: number): Touch | null => {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
  return null;
};

// ---- tap

const tap = (target: HTMLElement, x: number, y: number): void => {
  const screen = current;
  if (!screen.el.contains(target)) return;
  if (target.closest('.crumb')) {
    goUp();
    return;
  }
  if (target.closest('.title')) {
    if (screen.nodeId !== store.rootId) editTitle(x, y);
    return;
  }
  const row = target.closest('.row') as HTMLElement | null;
  if (row) {
    const id = row.dataset.id;
    const item = id ? store.items[id] : null;
    if (!id || !item) return;
    const link = target.closest('a');
    if (link) {
      openUrl((link as HTMLAnchorElement).href);
      return;
    }
    const hasChildren = item.children.some((c) => store.items[c]);
    if (hasChildren || x > row.getBoundingClientRect().right - EDGE_ZONE) drill(id);
    else editItem(row, id, x, y);
    return;
  }
  if (target.closest('.head')) return;
  startDraft(null);
};

// ---- swipe: right completes, left deletes

let swipe: { row: HTMLElement; face: HTMLElement; under: HTMLElement; id: string; base: number; dx: number; armed: -1 | 0 | 1 } | null = null;

const beginSwipe = (x: number): void => {
  const row = g.row!;
  g.mode = 'swipe';
  swipe = { row, face: qs(row, '.face'), under: qs(row, '.under'), id: row.dataset.id!, base: x, dx: 0, armed: 0 };
  swipe.face.getAnimations().forEach((a) => a.cancel());
  row.classList.add('swiping');
};

const moveSwipe = (x: number): void => {
  const s = swipe!;
  s.dx = x - s.base;
  s.face.style.transform = `translate3d(${s.dx}px,0,0)`;
  s.under.dataset.dir = s.dx > 0 ? '1' : '-1';
  s.under.style.setProperty('--p', String(clamp(Math.abs(s.dx) / SWIPE_ARM)));
  const armed = s.dx > SWIPE_ARM ? 1 : s.dx < -SWIPE_ARM ? -1 : 0;
  if (armed !== s.armed) {
    s.armed = armed;
    if (armed) haptic('light');
    s.row.classList.toggle('arm-done', armed === 1);
    s.row.classList.toggle('arm-del', armed === -1);
  }
};

const endSwipe = (cancelled: boolean): void => {
  const s = swipe!;
  swipe = null;
  let armed: -1 | 0 | 1 = cancelled ? 0 : s.armed;
  // A quick flick counts even if it didn't travel far
  if (!cancelled && !armed && Math.abs(g.vx) > 0.6 && Math.abs(s.dx) > 26 && Math.sign(g.vx) === Math.sign(s.dx)) {
    armed = s.dx > 0 ? 1 : -1;
  }
  const from = `translate3d(${s.dx}px,0,0)`;
  const { row, face, id } = s;

  if (armed === -1) {
    haptic('medium');
    row.classList.add('arm-del');
    const out = face.animate([{ transform: from }, { transform: 'translate3d(-105%,0,0)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
    // If another gesture has already started, wait for it rather than redrawing underneath it
    const remove = (): void => {
      if (isGesturing()) window.setTimeout(remove, 120);
      else removeItem(id);
    };
    out.onfinish = remove;
    return;
  }

  face.style.transform = '';
  const back = face.animate([{ transform: from }, { transform: 'translate3d(0,0,0)' }], { duration: 280, easing: EASE });
  back.onfinish = () => row.classList.remove('swiping');
  row.classList.remove('arm-done', 'arm-del');
  if (armed === 1 && store.items[id]) {
    haptic('medium');
    mutate(() => store.setCompleted(id, !store.items[id].isCompleted), true);
  }
};

// ---- pull down: a new line opens at the top; further, the way back up

let pull: { base: number; armed: 0 | 1 | 2; canUp: boolean } | null = null;

const beginPull = (y: number): void => {
  g.mode = 'pull';
  pull = { base: y, armed: 0, canUp: path.length > 1 };
  const { ghost } = current;
  ghost.style.display = 'flex';
  ghost.style.height = '';
  ghost.style.top = `${-ROW_H}px`;
};

const movePull = (y: number): void => {
  const p = pull!;
  const { list, ghost, upHint } = current;
  const raw = Math.max(0, y - p.base);
  const d = raw < 230 ? raw * 0.62 : 142.6 + (raw - 230) * 0.22;
  setY(list, d);
  const armed = p.canUp && d >= ROW_H * 2.25 ? 2 : d >= ROW_H ? 1 : 0;
  if (armed !== p.armed) {
    p.armed = armed;
    haptic('light');
    ghost.classList.toggle('armed', armed === 1);
    upHint.classList.toggle('armed', armed === 2);
  }
  ghost.style.opacity = String(armed === 2 ? 0.3 : clamp(d / ROW_H));
  upHint.style.opacity = p.canUp ? String(clamp((d - ROW_H * 1.3) / (ROW_H * 0.5))) : '0';
};

const endPull = (cancelled: boolean): void => {
  const p = pull!;
  pull = null;
  const screen = current;
  if (!cancelled && p.armed === 2 && goUp()) return;
  if (!cancelled && p.armed === 1) {
    const top = screen.ghost.getBoundingClientRect().top;
    const first = screen.rows.firstElementChild as HTMLElement | null;
    startDraft(first?.dataset.id && !first.classList.contains('done') ? first.dataset.id : null, top);
    return;
  }
  screen.render(true);
};

// ---- pull up at the bottom: clear what's completed

let pullUp: { base: number; armed: boolean } | null = null;

const beginPullUp = (y: number): void => {
  g.mode = 'pullup';
  pullUp = { base: y, armed: false };
  const n = store.doneCount(current.nodeId);
  current.clearHint.textContent = `Clear ${n} completed`;
};

const movePullUp = (y: number): void => {
  const p = pullUp!;
  const d = Math.max(0, p.base - y) * 0.55;
  setY(current.content, -d);
  current.clearHint.style.opacity = String(clamp(d / 48));
  const armed = d >= 74;
  if (armed !== p.armed) {
    p.armed = armed;
    haptic('light');
    current.clearHint.classList.toggle('armed', armed);
  }
};

const endPullUp = (cancelled: boolean): void => {
  const p = pullUp!;
  pullUp = null;
  if (!cancelled && p.armed) {
    haptic('medium');
    clearCompleted();
  } else {
    current.render(true);
  }
};

// ---- hold: pick a line up and move it

interface Drag {
  screen: Screen;
  row: HTMLElement;
  id: string;
  els: HTMLElement[];
  from: number;
  to: number;
  tops: number[];
  heights: number[];
  y0: number;
  x0: number;
  scroll0: number;
  intent: 'move' | 'into' | 'out';
  target: HTMLElement | null;
  frame: number;
}

let drag: Drag | null = null;

const beginDrag = (): void => {
  const row = g.row;
  if (g.mode !== 'pending' || !row || !row.dataset.id || transitioning) return;
  const screen = current;
  const els = screen.openRows();
  const from = els.indexOf(row);
  if (from < 0) return;
  g.mode = 'drag';
  haptic('medium');
  window.getSelection()?.removeAllRanges();
  drag = {
    screen,
    row,
    id: row.dataset.id,
    els,
    from,
    to: from,
    tops: els.map((el) => el.offsetTop),
    heights: els.map((el) => el.offsetHeight),
    y0: g.y,
    x0: g.x,
    scroll0: screen.scroller.scrollTop,
    intent: 'move',
    target: null,
    frame: 0,
  };
  screen.el.classList.add('dragging');
  row.classList.add('lifted');
  const tick = () => {
    const d = drag;
    if (!d) return;
    const box = d.screen.scroller.getBoundingClientRect();
    const edge = 84;
    let speed = 0;
    if (g.y < box.top + edge) speed = -Math.ceil(((box.top + edge - g.y) / edge) * 14);
    else if (g.y > box.bottom - edge) speed = Math.ceil(((g.y - (box.bottom - edge)) / edge) * 14);
    if (speed) {
      d.screen.scroller.scrollTop += speed;
      layoutDrag();
    }
    d.frame = requestAnimationFrame(tick);
  };
  drag.frame = requestAnimationFrame(tick);
  layoutDrag();
};

const layoutDrag = (): void => {
  const d = drag!;
  const dy = g.y - d.y0 + (d.screen.scroller.scrollTop - d.scroll0);
  const dx = g.x - d.x0;
  setY(d.row, dy || 0.01);

  // Where it would land: after every other line whose middle is above its own
  const center = d.tops[d.from] + d.heights[d.from] / 2 + dy;
  let to = 0;
  d.els.forEach((_, i) => {
    if (i !== d.from && d.tops[i] + d.heights[i] / 2 < center) to++;
  });
  if (to !== d.to) {
    d.to = to;
    haptic('tick');
  }
  const h = d.heights[d.from];
  let others = 0;
  let above: HTMLElement | null = null;
  for (let i = 0; i < d.els.length; i++) {
    if (i === d.from) continue;
    const el = d.els[i];
    const slot = others < to ? others : others + 1;
    if (others === to - 1) above = el;
    setY(el, slot < i ? -h : slot > i ? h : 0);
    others++;
  }

  // Sideways says how deep: right tucks it into the line above, left moves it out a level
  const intent: Drag['intent'] = dx > NEST_ARM && above ? 'into' : dx < -NEST_ARM && path.length > 1 ? 'out' : 'move';
  const target = intent === 'into' ? above : null;
  if (intent !== d.intent || target !== d.target) {
    if (intent !== d.intent) haptic('light');
    d.target?.classList.remove('nest-target');
    target?.classList.add('nest-target');
    d.row.classList.toggle('intent-into', intent === 'into');
    d.row.classList.toggle('intent-out', intent === 'out');
    d.screen.crumb.classList.toggle('drop-target', intent === 'out');
    d.intent = intent;
    d.target = target;
  }
};

const endDrag = (cancelled: boolean): void => {
  const d = drag!;
  drag = null;
  cancelAnimationFrame(d.frame);
  const { screen, row, id } = d;
  const rect = row.getBoundingClientRect();
  // Measure while the lines are still where the drag put them, then let render settle them
  const seed = new Map<Element, number>();
  for (const el of Array.from(screen.rows.children)) seed.set(el, el.getBoundingClientRect().top);
  screen.el.classList.remove('dragging');
  screen.crumb.classList.remove('drop-target');
  d.target?.classList.remove('nest-target');
  const settle = () => row.classList.remove('lifted', 'intent-into', 'intent-out');

  if (!cancelled && d.intent === 'into' && d.target?.dataset.id) {
    const targetId = d.target.dataset.id;
    const targetRect = d.target.getBoundingClientRect();
    haptic('medium');
    screen.rowEls.delete(id);
    screen.floatOut(row, rect.top, { opacity: 0, transform: `translate3d(24px,${targetRect.top - rect.top}px,0) scale(0.5)` }, 240);
    mutate(() => store.moveInto(id, targetId), true, seed);
    screen.flash(targetId);
    return;
  }
  if (!cancelled && d.intent === 'out') {
    const headRect = screen.crumb.getBoundingClientRect();
    haptic('medium');
    screen.rowEls.delete(id);
    screen.floatOut(row, rect.top, { opacity: 0, transform: `translate3d(-12px,${headRect.top - rect.top}px,0) scale(0.5)` }, 260);
    mutate(() => store.moveOut(id), true, seed);
    return;
  }

  const order = d.els.filter((el) => el !== row).map((el) => el.dataset.id!);
  order.splice(cancelled ? d.from : d.to, 0, id);
  if (!cancelled && d.to !== d.from) haptic('light');
  mutate(() => store.reorder(screen.nodeId, order), true, seed);
  window.setTimeout(settle, 200);
};

// ---- pinch: apart opens a new line between two others, together goes up a level

interface Pinch {
  screen: Screen;
  d0: number;
  above: HTMLElement[];
  below: HTMLElement[];
  boundary: number;
  beforeId: string | null;
  armed: -1 | 0 | 1;
  canUp: boolean;
}

let pinch: Pinch | null = null;

const touchDistance = (e: TouchEvent): number => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

const beginPinch = (e: TouchEvent): void => {
  const screen = current;
  g.mode = 'pinch';
  const mid = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  const open = screen.openRows();
  let k = 0;
  for (const el of open) {
    const r = el.getBoundingClientRect();
    if (r.top + r.height / 2 < mid) k++;
  }
  const all = Array.from(screen.rows.children) as HTMLElement[];
  const at = k < open.length ? all.indexOf(open[k]) : open.length ? all.indexOf(open[open.length - 1]) + 1 : 0;
  pinch = {
    screen,
    d0: touchDistance(e),
    above: [screen.head, ...all.slice(0, at)],
    below: [...all.slice(at), screen.tail],
    boundary: all[at] ? all[at].offsetTop : screen.rows.offsetHeight,
    beforeId: k < open.length ? open[k].dataset.id! : null,
    armed: 0,
    canUp: path.length > 1,
  };
};

const movePinch = (e: TouchEvent): void => {
  const p = pinch!;
  const { ghost, content } = p.screen;
  const delta = touchDistance(e) - p.d0;
  let armed: Pinch['armed'] = 0;
  if (delta >= 0) {
    const gap = delta <= ROW_H ? delta : ROW_H + (delta - ROW_H) * 0.22;
    p.above.forEach((el) => setY(el, -gap / 2));
    p.below.forEach((el) => setY(el, gap / 2));
    ghost.style.display = 'flex';
    ghost.style.top = `${p.boundary - gap / 2}px`;
    ghost.style.height = `${gap}px`;
    ghost.style.opacity = String(clamp(gap / ROW_H));
    content.style.transform = '';
    content.style.opacity = '';
    armed = gap >= ROW_H * 0.9 ? 1 : 0;
  } else {
    p.above.forEach((el) => setY(el, 0));
    p.below.forEach((el) => setY(el, 0));
    ghost.style.display = 'none';
    const t = clamp(-delta / 150);
    content.style.transform = `scale(${1 - t * 0.1})`;
    content.style.opacity = String(1 - t * 0.5);
    armed = p.canUp && t >= 0.5 ? -1 : 0;
  }
  if (armed !== p.armed) {
    p.armed = armed;
    haptic('light');
    ghost.classList.toggle('armed', armed === 1);
  }
};

const endPinch = (cancelled: boolean): void => {
  const p = pinch!;
  pinch = null;
  const { screen } = p;
  if (!cancelled && p.armed === 1) {
    startDraft(p.beforeId, screen.ghost.getBoundingClientRect().top);
    return;
  }
  if (!cancelled && p.armed === -1 && goUp()) return;
  if (screen.content.style.transform) {
    const from = { transform: screen.content.style.transform, opacity: screen.content.style.opacity };
    screen.content.style.transform = '';
    screen.content.style.opacity = '';
    screen.content.animate([from, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: EASE });
  }
  screen.render(true);
};

// ---- dispatch

const onTouchStart = (e: TouchEvent): void => {
  if (transitioning || !booted) {
    e.preventDefault();
    return;
  }
  const n = e.touches.length;
  if (n === 1) {
    const t = e.touches[0];
    g.id = t.identifier;
    g.x0 = g.x = t.clientX;
    g.y0 = g.y = t.clientY;
    g.vx = 0;
    g.lastT = e.timeStamp;
    g.target = t.target as HTMLElement;
    g.row = g.target.closest('.row') as HTMLElement | null;
    clearTimeout(g.timer);
    if (editing) {
      g.mode = editing.el.contains(g.target) ? 'native' : 'dismiss';
      return;
    }
    // A touch that lands while the list is still coasting only stops it
    if (performance.now() - lastScrollAt < 90) {
      g.mode = 'scroll';
      return;
    }
    g.mode = 'pending';
    if (g.row && g.row.dataset.id && !g.row.classList.contains('done')) {
      g.timer = window.setTimeout(beginDrag, HOLD_MS);
    }
  } else if (n === 2 && g.mode === 'pending') {
    clearTimeout(g.timer);
    beginPinch(e);
  }
};

const onTouchMove = (e: TouchEvent): void => {
  if (g.mode === 'pinch') {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length >= 2) movePinch(e);
    return;
  }
  const t = findTouch(e.touches, g.id);
  if (!t) return;
  const dt = Math.max(1, e.timeStamp - g.lastT);
  g.vx = 0.6 * ((t.clientX - g.x) / dt) + 0.4 * g.vx;
  g.lastT = e.timeStamp;
  g.x = t.clientX;
  g.y = t.clientY;
  const dx = g.x - g.x0;
  const dy = g.y - g.y0;

  switch (g.mode) {
    case 'pending': {
      if (Math.hypot(dx, dy) < 4) return;
      clearTimeout(g.timer);
      const s = current.scroller;
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (g.row?.dataset.id && Math.abs(dx) > Math.abs(dy) * 1.2) {
        beginSwipe(g.x);
      } else if (vertical && dy > 0 && s.scrollTop <= 0) {
        beginPull(g.y);
      } else if (vertical && dy < 0 && s.scrollTop + s.clientHeight >= s.scrollHeight - 1 && store.doneCount(current.nodeId) > 0) {
        beginPullUp(g.y);
      } else {
        g.mode = 'scroll';
        return;
      }
      if (e.cancelable) e.preventDefault();
      return;
    }
    case 'dismiss':
      if (Math.hypot(dx, dy) > 10) g.mode = 'scroll';
      return;
    case 'swipe':
      if (e.cancelable) e.preventDefault();
      moveSwipe(g.x);
      return;
    case 'pull':
      if (e.cancelable) e.preventDefault();
      movePull(g.y);
      return;
    case 'pullup':
      if (e.cancelable) e.preventDefault();
      movePullUp(g.y);
      return;
    case 'drag':
      if (e.cancelable) e.preventDefault();
      layoutDrag();
      return;
    default:
      return;
  }
};

const onTouchEnd = (e: TouchEvent): void => {
  const cancelled = e.type === 'touchcancel';
  const remaining = e.touches.length;
  const settle = () => {
    if (remaining === 0) g.mode = 'idle';
    if (!isGesturing() && renderQueued) {
      renderQueued = false;
      syncNavigation();
      current.render(true);
    }
  };

  if (g.mode === 'pinch') {
    if (remaining < 2) {
      g.mode = 'spent';
      endPinch(cancelled);
    }
    settle();
    return;
  }
  if (findTouch(e.touches, g.id)) return;

  const mode = g.mode;
  clearTimeout(g.timer);
  g.mode = 'spent';
  switch (mode) {
    case 'pending':
      if (!cancelled && g.target) {
        // Handled here rather than as a click: no delay, and no stray focus changes
        if (e.cancelable) e.preventDefault();
        tap(g.target, g.x0, g.y0);
      }
      break;
    case 'dismiss':
      if (!cancelled) {
        if (e.cancelable) e.preventDefault();
        finishEdit('blur');
      }
      break;
    case 'swipe':
      endSwipe(cancelled);
      break;
    case 'pull':
      endPull(cancelled);
      break;
    case 'pullup':
      endPullUp(cancelled);
      break;
    case 'drag':
      endDrag(cancelled);
      break;
    default:
      break;
  }
  settle();
};

app.addEventListener('touchstart', onTouchStart, { passive: false });
app.addEventListener('touchmove', onTouchMove, { passive: false });
app.addEventListener('touchend', onTouchEnd, { passive: false });
app.addEventListener('touchcancel', onTouchEnd, { passive: false });
app.addEventListener('contextmenu', (e) => {
  if (!editing?.el.contains(e.target as Node)) e.preventDefault();
});

// Mouse (and anything else that isn't touch) gets the tap behaviours, which is enough for a desktop browser
app.addEventListener('click', (e) => {
  if (!booted || transitioning) return;
  const target = e.target as HTMLElement;
  if (editing) {
    if (!editing.el.contains(target)) finishEdit('blur');
    return;
  }
  tap(target, e.clientX, e.clientY);
});

// --------------------------------------------------------------------- boot

const syncEl = document.getElementById('sync')!;
let syncTimer = 0;
store.onStatus(() => {
  clearTimeout(syncTimer);
  syncEl.classList.toggle('error', store.status === 'error');
  // Saving is silent unless it is taking long enough to be worth knowing about
  if (store.status === 'saving') syncTimer = window.setTimeout(() => syncEl.classList.add('pending'), 2500);
  else syncEl.classList.remove('pending');
});

const boot = (): void => {
  if (booted) return;
  booted = true;
  app.textContent = '';
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOCATION_KEY);
  } catch {
    /* start at the top */
  }
  path = (saved && store.pathTo(saved)) || [store.rootId];
  show(path[path.length - 1], 0);
  requestAnimationFrame(hideSplash);
};

store.onChange(() => {
  if (!booted) {
    if (store.ready) boot();
    return;
  }
  if (renderLock) return;
  if (isGesturing()) {
    renderQueued = true;
    return;
  }
  syncNavigation();
  current.render(true);
});

onBackButton(() => {
  if (editing) {
    finishEdit('blur');
    return true;
  }
  return goUp();
});

onAppResume(() => {
  if (booted && !editing && !isGesturing()) current.render(false);
});

syncSystemBars();

if (store.ready) {
  boot();
} else {
  // First launch: nothing to show until the server answers
  hideSplash();
  window.setTimeout(() => {
    if (!booted) app.innerHTML = '<div class="waiting">Connecting</div>';
  }, 1200);
}
