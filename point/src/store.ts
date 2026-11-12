import { doc, setDoc, onSnapshot, deleteField, FieldValue } from 'firebase/firestore';
import { db, COLLECTION, DOC_ID } from './firebase';
import { LOCAL_ONLY, READ_ONLY } from './flags';
import { Item, ItemMap, OutlineState, SyncStatus } from './types';
import { sampleState } from './sample';

const LOCAL_KEY = 'point-local-data';
const SAVE_DEBOUNCE_MS = 600;
const ROOT_ID = 'root';

export type Undo = () => void;
type ChangeCause = 'local' | 'remote';

const newId = (): string => Math.random().toString(36).slice(2, 11);

const itemsEqual = (a?: Item, b?: Item): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.text === b.text &&
    !!a.collapsed === !!b.collapsed &&
    !!a.isCompleted === !!b.isCompleted &&
    !!a.isTask === !!b.isTask &&
    !!a.isDivider === !!b.isDivider &&
    !!a.isShortcut === !!b.isShortcut &&
    !!a.isBold === !!b.isBold &&
    !!a.isItalic === !!b.isItalic &&
    !!a.isUnderlined === !!b.isUnderlined &&
    (a.fontSize || 'small') === (b.fontSize || 'small') &&
    (a.todoistId || '') === (b.todoistId || '') &&
    a.children.length === b.children.length &&
    a.children.every((c, i) => c === b.children[i])
  );
};

// Three-way merge, identical to the main app: anything edited here since the last sync keeps the
// local version, everything else takes the server's. Unchanged items keep their object identity.
export const mergeRemoteItems = (local: ItemMap, base: ItemMap, remote: ItemMap): { merged: ItemMap; changed: boolean } => {
  const merged: ItemMap = {};
  let changed = false;
  const ids = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  ids.forEach((id) => {
    const l = local[id];
    const r = remote[id];
    const locallyChanged = !itemsEqual(l, base[id]);
    const pick = locallyChanged ? l : itemsEqual(r, l) ? l : r;
    if (pick) merged[id] = pick;
    if (pick !== l) changed = true;
  });
  return { merged, changed };
};

const isValidState = (s: unknown): s is OutlineState => {
  const state = s as OutlineState | null;
  return !!state && typeof state === 'object' && !!state.items && !!state.items[state.rootId];
};

const readLocal = (): OutlineState | null => {
  if (LOCAL_ONLY) return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export class Store {
  state: OutlineState;
  /** True once there is real data to show (a local copy, or the first answer from the server) */
  ready: boolean;
  status: SyncStatus = 'saved';

  private changeListeners = new Set<(cause: ChangeCause) => void>();
  private statusListeners = new Set<() => void>();
  private parentCache: Record<string, string> | null = null;

  // Items as we believe they exist on the server. Saves upload only the difference, and
  // incoming snapshots are merged against it so edits made here are never lost.
  private synced: ItemMap | null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrites = 0;
  private hadLocal: boolean;

  constructor() {
    const local = readLocal();
    this.hadLocal = local !== null;
    this.state = local ?? (LOCAL_ONLY ? sampleState() : { items: { [ROOT_ID]: blankItem(ROOT_ID, 'Home') }, rootId: ROOT_ID });
    this.synced = local?.items ?? null;
    this.ready = this.hadLocal || LOCAL_ONLY;
    if (LOCAL_ONLY) this.status = 'local';
    this.connect();

    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden' && this.saveTimer) this.flush();
    };
    document.addEventListener('visibilitychange', flushIfHidden);
    window.addEventListener('pagehide', flushIfHidden);
  }

  // ---------------------------------------------------------------- reading

  get items(): ItemMap {
    return this.state.items;
  }

  get rootId(): string {
    return this.state.rootId;
  }

  onChange(listener: (cause: ChangeCause) => void): void {
    this.changeListeners.add(listener);
  }

  onStatus(listener: () => void): void {
    this.statusListeners.add(listener);
  }

  parentOf(id: string): string | null {
    if (!this.parentCache) {
      const parents: Record<string, string> = {};
      for (const pid in this.items) {
        for (const child of this.items[pid].children) parents[child] = pid;
      }
      this.parentCache = parents;
    }
    return this.parentCache[id] ?? null;
  }

  /** Root → id, or null when the item is gone or detached */
  pathTo(id: string): string[] | null {
    const path: string[] = [];
    let current: string | null = id;
    while (current) {
      if (!this.items[current] || path.includes(current)) return null;
      path.unshift(current);
      if (current === this.rootId) return path;
      current = this.parentOf(current);
    }
    return null;
  }

  /** Children as Point shows them: open items first, completed ones sunk to the bottom */
  display(parentId: string): string[] {
    const parent = this.items[parentId];
    if (!parent) return [];
    const open: string[] = [];
    const done: string[] = [];
    for (const id of parent.children) {
      const child = this.items[id];
      if (!child) continue;
      (child.isCompleted ? done : open).push(id);
    }
    return open.concat(done);
  }

  /** Open items that are real lines: dividers don't count as things inside a line */
  openLineCount(parentId: string): number {
    const parent = this.items[parentId];
    if (!parent) return 0;
    let n = 0;
    for (const id of parent.children) {
      const child = this.items[id];
      if (child && !child.isCompleted && !child.isDivider) n++;
    }
    return n;
  }

  /** True when a line has anything inside it other than dividers */
  hasLines(id: string): boolean {
    return !!this.items[id]?.children.some((c) => this.items[c] && !this.items[c].isDivider);
  }

  openCount(parentId: string): number {
    const parent = this.items[parentId];
    if (!parent) return 0;
    let n = 0;
    for (const id of parent.children) if (this.items[id] && !this.items[id].isCompleted) n++;
    return n;
  }

  subtreeSize(id: string): number {
    let n = 0;
    const stack = [id];
    while (stack.length) {
      const item = this.items[stack.pop()!];
      if (!item) continue;
      if (!item.isDivider || item.id === id) n++;
      stack.push(...item.children);
    }
    return n;
  }

  // -------------------------------------------------------------- mutations

  /** Insert a new item before `beforeId` (as displayed), or at the end of the open items */
  add(parentId: string, beforeId: string | null, html: string, extra: Partial<Item> = {}): string | null {
    const parent = this.items[parentId];
    if (!parent) return null;
    const id = newId();
    const order = this.display(parentId);
    let index = beforeId ? order.indexOf(beforeId) : -1;
    if (index < 0) index = this.openCount(parentId);
    order.splice(index, 0, id);
    this.commit({
      ...this.items,
      [id]: { ...blankItem(id, html), ...extra },
      [parentId]: { ...parent, children: order },
    });
    return id;
  }

  /** Insert a divider line before `beforeId` (as displayed), or at the end of the open items */
  addDivider(parentId: string, beforeId: string | null): string | null {
    return this.add(parentId, beforeId, '', { isDivider: true });
  }

  setText(id: string, html: string): void {
    const item = this.items[id];
    if (!item || item.text === html) return;
    this.commit({ ...this.items, [id]: { ...item, text: html } });
  }

  /** Link a line to its Todoist task. An empty id unlinks it (the field is kept, so the change syncs). */
  setTodoistId(id: string, todoistId: string): void {
    const item = this.items[id];
    if (!item || (item.todoistId || '') === todoistId) return;
    this.commit({ ...this.items, [id]: { ...item, todoistId } });
  }

  setCompleted(id: string, done: boolean): void {
    const item = this.items[id];
    const parentId = this.parentOf(id);
    if (!item || !parentId || !!item.isCompleted === done) return;
    const parent = this.items[parentId];
    // Both directions land on the boundary: last of the open items, or first of the completed ones
    const order = this.display(parentId).filter((c) => c !== id);
    const boundary = order.filter((c) => !this.items[c].isCompleted).length;
    order.splice(boundary, 0, id);
    this.commit({
      ...this.items,
      [id]: { ...item, isCompleted: done },
      [parentId]: { ...parent, children: order },
    });
  }

  /** New order for the open items of a list (completed ones stay below) */
  reorder(parentId: string, openOrder: string[]): void {
    const parent = this.items[parentId];
    if (!parent) return;
    const current = this.display(parentId);
    const currentOpen = current.filter((c) => !this.items[c].isCompleted);
    const wanted = openOrder.filter((c) => currentOpen.includes(c));
    const missing = currentOpen.filter((c) => !wanted.includes(c));
    const done = current.filter((c) => this.items[c].isCompleted);
    const order = [...wanted, ...missing, ...done];
    if (order.every((c, i) => c === parent.children[i]) && order.length === parent.children.length) return;
    this.commit({ ...this.items, [parentId]: { ...parent, children: order } });
  }

  /** Move an item to the end of another item's open children */
  moveInto(id: string, targetId: string): boolean {
    const fromId = this.parentOf(id);
    if (!fromId || !this.items[id] || !this.items[targetId] || id === targetId) return false;
    // Never move an item inside its own subtree
    const targetPath = this.pathTo(targetId);
    if (!targetPath || targetPath.includes(id)) return false;

    const items = { ...this.items };
    items[fromId] = { ...items[fromId], children: items[fromId].children.filter((c) => c !== id) };
    this.state = { ...this.state, items };
    this.parentCache = null;
    const order = this.display(targetId).filter((c) => c !== id);
    const boundary = order.filter((c) => !items[c].isCompleted).length;
    order.splice(boundary, 0, id);
    items[targetId] = { ...items[targetId], children: order };
    this.commit(items);
    return true;
  }

  /** Move an item up a level, to just below the list it was in */
  moveOut(id: string): boolean {
    const parentId = this.parentOf(id);
    const grandId = parentId ? this.parentOf(parentId) : null;
    if (!parentId || !grandId || !this.items[id]) return false;
    const items = { ...this.items };
    items[parentId] = { ...items[parentId], children: items[parentId].children.filter((c) => c !== id) };
    const siblings = items[grandId].children.filter((c) => c !== id);
    siblings.splice(siblings.indexOf(parentId) + 1, 0, id);
    items[grandId] = { ...items[grandId], children: siblings };
    this.commit(items);
    return true;
  }

  /** Delete an item and everything inside it */
  remove(id: string): Undo | null {
    return this.removeAll([id]);
  }

  /** Delete several items, wherever they sit, as one change with one undo */
  removeAll(ids: string[]): Undo | null {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const parentId = this.parentOf(id);
      if (!parentId || !this.items[id]) continue;
      groups.set(parentId, [...(groups.get(parentId) ?? []), id]);
    }
    if (groups.size === 0) return null;

    const items = { ...this.items };
    const removed: ItemMap = {};
    const before = new Map<string, string[]>();
    groups.forEach((gone, parentId) => {
      before.set(parentId, this.items[parentId].children);
      const stack = [...gone];
      while (stack.length) {
        const current = stack.pop()!;
        const item = items[current];
        if (!item) continue;
        removed[current] = item;
        delete items[current];
        stack.push(...item.children);
      }
    });
    groups.forEach((gone, parentId) => {
      const parent = items[parentId];
      if (parent) items[parentId] = { ...parent, children: parent.children.filter((c) => !gone.includes(c)) };
    });
    this.commit(items);

    return () => {
      const next = { ...this.items, ...removed };
      groups.forEach((gone, parentId) => {
        const now = next[parentId];
        if (!now) return;
        // Put each one back after the nearest earlier sibling that still exists
        const was = before.get(parentId)!;
        const children = [...now.children];
        for (const id of gone) {
          if (children.includes(id)) continue;
          let at = 0;
          for (let i = was.indexOf(id) - 1; i >= 0; i--) {
            const anchor = children.indexOf(was[i]);
            if (anchor >= 0) {
              at = anchor + 1;
              break;
            }
          }
          children.splice(at, 0, id);
        }
        next[parentId] = { ...now, children };
      });
      this.commit(next);
    };
  }

  private commit(items: ItemMap): void {
    this.state = { ...this.state, items };
    this.parentCache = null;
    this.setStatus(db ? 'saving' : 'local');
    this.scheduleSave();
    this.emit('local');
  }

  private emit(cause: ChangeCause): void {
    this.changeListeners.forEach((listener) => listener(cause));
  }

  private setStatus(status: SyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }

  // ------------------------------------------------------------------- sync

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const current = this.state;

    if (!LOCAL_ONLY) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(current));
      } catch (e) {
        console.error('Failed to save local copy', e);
      }
    }

    if (!db) {
      this.setStatus('local');
      return;
    }
    const base = this.synced;
    if (base === null) return; // Not synced yet; the first snapshot triggers a save

    const updates: Record<string, Item | FieldValue> = {};
    let changes = 0;
    for (const id in current.items) {
      if (!itemsEqual(current.items[id], base[id])) {
        updates[id] = current.items[id];
        changes++;
      }
    }
    for (const id in base) {
      if (!(id in current.items)) {
        updates[id] = deleteField();
        changes++;
      }
    }

    if (changes === 0 || READ_ONLY) {
      if (this.pendingWrites === 0) this.setStatus('saved');
      return;
    }

    this.synced = current.items;
    this.pendingWrites++;
    this.setStatus('saving');

    setDoc(doc(db, COLLECTION, DOC_ID), { items: updates, rootId: current.rootId }, { merge: true })
      .then(() => {
        this.pendingWrites--;
        if (this.pendingWrites === 0 && !this.saveTimer) this.setStatus('saved');
      })
      .catch((error) => {
        this.pendingWrites--;
        console.error('Error saving to Firebase', error);
        // Server state is now unknown: upload everything again on the next save
        this.synced = {};
        this.setStatus('error');
      });
  }

  private applyRemote(remoteItems: ItemMap, rootId: string): void {
    const base = this.synced;
    this.synced = remoteItems;

    if (base === null) {
      // First sync on a device with no local copy: take the server state as it is
      this.state = { items: remoteItems, rootId };
      this.parentCache = null;
      this.ready = true;
      this.emit('remote');
      this.scheduleSave(); // writes the local copy; nothing differs, so nothing is uploaded
      return;
    }

    const { merged, changed } = mergeRemoteItems(this.items, base, remoteItems);
    if (changed && merged[this.rootId]) {
      this.state = { ...this.state, items: merged };
      this.parentCache = null;
      this.emit('remote');
    }
    // Upload any local edits the server doesn't have yet
    this.scheduleSave();
  }

  private connect(): void {
    if (!db) return;
    onSnapshot(
      doc(db, COLLECTION, DOC_ID),
      (snap) => {
        // With a local copy we already render instantly; only trust the server's view
        if (snap.metadata.fromCache && (this.hadLocal || !snap.exists())) return;

        if (!snap.exists()) {
          // Nothing on the server yet: start from what we have
          if (this.synced === null) {
            this.ready = true;
            this.emit('remote');
          }
          this.synced = {};
          this.scheduleSave();
          return;
        }

        const data = snap.data() as Partial<OutlineState>;
        const rootId = data.rootId || ROOT_ID;
        if (!data.items || !data.items[rootId]) return;
        this.applyRemote(data.items, rootId);
      },
      (error) => {
        console.error('Error syncing with Firebase', error);
        this.setStatus('error');
        if (!this.ready) {
          this.ready = true;
          this.emit('remote');
        }
      }
    );
  }
}

function blankItem(id: string, text: string): Item {
  return {
    id,
    text,
    children: [],
    isCompleted: false,
    collapsed: false,
    fontSize: 'small',
    isTask: false,
    isShortcut: false,
  };
}
