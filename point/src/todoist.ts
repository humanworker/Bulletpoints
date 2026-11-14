import { Store } from './store';
import { htmlToPlain } from './text';

// Sending a line to Todoist, due today, and keeping "done" in step both ways.
//
// Everything runs on the phone: there is no server. So a task completed in Todoist is noticed the
// next time Point looks (on opening, on coming back to it, and about once a minute while open).
//
// The API token and the bookkeeping below never leave the device. Only the Todoist task id is
// stored on the item, in the shared outline.

const API = 'https://api.todoist.com/api/v1';
const TOKEN_KEY = 'point-todoist-token';
const STATE_KEY = 'point-todoist-state';

/** What Todoist was last known, or told, to hold for a task */
interface Shadow {
  done: boolean;
  content: string;
  /** The parent line's name, kept in the task's description for context. Absent in older bookkeeping. */
  description?: string;
}

interface State {
  /** Items marked for today that Todoist hasn't been told about yet */
  pending: string[];
  /** Todoist task id → last agreed state */
  shadow: Record<string, Shadow>;
  /** Todoist task ids that still need deleting there */
  deletes: string[];
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`Todoist answered ${status}`);
  }
}

const isStatus = (error: unknown, status: number): boolean => error instanceof HttpError && error.status === status;

interface RemoteTask {
  id: string;
  content: string;
  checked?: boolean;
  is_deleted?: boolean;
  completed_at?: string | null;
  description?: string;
}

const taskText = (html: string): string => htmlToPlain(html).replace(/\s+/g, ' ').trim();

export class Today {
  /** 'ok' unless the last attempt to talk to Todoist failed */
  status: 'ok' | 'error' = 'ok';

  private token: string | null = null;
  private state: State = { pending: [], shadow: {}, deletes: [] };
  private listeners = new Set<() => void>();
  private running = false;
  private queued: boolean | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private store: Store) {
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null') as Partial<State> | null;
      if (saved) {
        this.state = {
          pending: Array.isArray(saved.pending) ? saved.pending : [],
          shadow: saved.shadow && typeof saved.shadow === 'object' ? saved.shadow : {},
          deletes: Array.isArray(saved.deletes) ? saved.deletes : [],
        };
      }
    } catch {
      /* start unconnected */
    }
    // Striking, restoring or rewording a linked line is pushed shortly after it happens
    store.onChange(() => this.schedule(false, 700));
  }

  // ---------------------------------------------------------------- reading

  /** The name of the line's parent, for the task's description. Empty at the top level, where it would only say "Home". */
  private contextOf(id: string): string {
    const parentId = this.store.parentOf(id);
    if (!parentId || parentId === this.store.rootId) return '';
    const parent = this.store.items[parentId];
    return parent ? taskText(parent.text) : '';
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  hasToken(): boolean {
    return !!this.token;
  }

  /** Marked for today, whether or not Todoist knows yet */
  isMarked(id: string): boolean {
    return !!this.store.items[id]?.todoistId || this.state.pending.includes(id);
  }

  /** Marked, but not yet created in Todoist (offline, or still on its way) */
  isPending(id: string): boolean {
    return !this.store.items[id]?.todoistId && this.state.pending.includes(id);
  }

  // ---------------------------------------------------------------- actions

  /** Check a token against Todoist and keep it if it works. 'offline' means it couldn't be checked. */
  async connect(token: string): Promise<'ok' | 'rejected' | 'offline'> {
    const candidate = token.trim();
    if (!candidate) return 'rejected';
    try {
      await this.call('GET', '/tasks?limit=1', undefined, candidate);
    } catch (error) {
      return error instanceof HttpError ? 'rejected' : 'offline';
    }
    this.token = candidate;
    try {
      localStorage.setItem(TOKEN_KEY, candidate);
    } catch {
      /* it will be asked for again next launch */
    }
    return 'ok';
  }

  /** Send a line to today, or take it back out. Returns whether it is now marked. */
  toggle(id: string): boolean {
    const item = this.store.items[id];
    if (!item) return false;
    let marked: boolean;
    if (item.todoistId) {
      this.state.deletes.push(item.todoistId);
      delete this.state.shadow[item.todoistId];
      this.store.setTodoistId(id, '');
      marked = false;
    } else if (this.state.pending.includes(id)) {
      this.state.pending = this.state.pending.filter((p) => p !== id);
      marked = false;
    } else {
      this.state.pending.push(id);
      marked = true;
    }
    this.save();
    this.emit();
    this.schedule(false, 0);
    return marked;
  }

  /** Bring both sides into step. `pull` also asks Todoist what changed there. */
  sync(pull: boolean): void {
    this.schedule(pull, 0);
  }

  // ------------------------------------------------------------------- sync

  private schedule(pull: boolean, delay: number): void {
    // Without the outline loaded there is nothing to compare against, and acting on an empty one
    // would look like every linked line had been deleted
    if (!this.token || !this.store.ready) return;
    this.queued = this.queued || pull;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.running || this.queued === null) return;
    const pull = this.queued;
    this.queued = null;
    this.running = true;
    try {
      await this.pass(pull);
      this.setStatus('ok');
    } catch (error) {
      if (isStatus(error, 401)) {
        // The token was revoked or replaced: forget it, and ask again the next time it's needed
        this.token = null;
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* nothing to forget */
        }
      }
      console.warn('Todoist sync did not finish', error);
      this.setStatus('error');
    } finally {
      this.running = false;
      this.save();
    }
    if (this.queued !== null) void this.run();
  }

  private async pass(pull: boolean): Promise<void> {
    const { store, state } = this;

    // 1. Lines taken back out of today
    for (const taskId of [...state.deletes]) {
      try {
        await this.call('DELETE', `/tasks/${taskId}`);
      } catch (error) {
        if (!isStatus(error, 404)) throw error;
      }
      state.deletes = state.deletes.filter((d) => d !== taskId);
      this.save();
    }

    // 2. Lines newly sent to today
    for (const itemId of [...state.pending]) {
      const item = store.items[itemId];
      const content = item ? taskText(item.text) : '';
      if (!item || item.todoistId || !content) {
        state.pending = state.pending.filter((p) => p !== itemId);
        continue;
      }
      const description = this.contextOf(itemId);
      const body: Record<string, string> = { content, due_string: 'today' };
      if (description) body.description = description;
      const task = (await this.call('POST', '/tasks', body)) as RemoteTask;
      const taskId = String(task.id);
      if (!state.pending.includes(itemId) || !store.items[itemId]) {
        // Taken back out, or removed, while the request was on its way
        state.deletes.push(taskId);
        this.save();
        continue;
      }
      state.pending = state.pending.filter((p) => p !== itemId);
      state.shadow[taskId] = { done: false, content, description };
      this.save();
      store.setTodoistId(itemId, taskId);
      this.emit();
    }

    // 3. Every linked line: whichever side changed since they last agreed wins
    const live = new Set<string>();
    for (const linked of Object.values(store.items).filter((i) => i.todoistId)) {
      const taskId = linked.todoistId!;
      live.add(taskId);
      try {
        let shadow = state.shadow[taskId];
        if (pull || !shadow) {
          const remote = await this.fetchTask(taskId);
          if (!remote) {
            // Deleted in Todoist: the line stays, it just isn't a task any more
            delete state.shadow[taskId];
            store.setTodoistId(linked.id, '');
            continue;
          }
          if (!shadow) {
            // No record of what was last agreed (first sight of this link on this phone).
            // Start from Todoist's version, and never let that undo a completion on either side.
            shadow = state.shadow[taskId] = { ...remote };
            if (remote.done && !store.items[linked.id]?.isCompleted) store.setCompleted(linked.id, true);
          } else if (remote.done !== shadow.done) {
            shadow.done = remote.done;
            if (!!store.items[linked.id]?.isCompleted !== remote.done) store.setCompleted(linked.id, remote.done);
          }
        }
        const item = store.items[linked.id];
        if (!item) continue;
        if (!!item.isCompleted !== shadow.done) {
          await this.call('POST', `/tasks/${taskId}/${item.isCompleted ? 'close' : 'reopen'}`);
          shadow.done = !!item.isCompleted;
        }
        const content = taskText(item.text);
        const description = this.contextOf(linked.id);
        const update: Record<string, string> = {};
        if (content && content !== shadow.content) update.content = content;
        if (description !== (shadow.description ?? '')) update.description = description;
        if (Object.keys(update).length) {
          await this.call('POST', `/tasks/${taskId}`, update);
          if (update.content !== undefined) shadow.content = update.content;
          if (update.description !== undefined) shadow.description = update.description;
        }
      } catch (error) {
        if (!isStatus(error, 404)) throw error;
        delete state.shadow[taskId];
        store.setTodoistId(linked.id, '');
      }
    }

    // 4. Lines that no longer exist: forget them, and leave their tasks in Todoist as they are
    for (const taskId of Object.keys(state.shadow)) {
      if (!live.has(taskId)) delete state.shadow[taskId];
    }
  }

  /** The task as Todoist has it, or null if it is gone */
  private async fetchTask(taskId: string): Promise<Shadow | null> {
    try {
      const task = (await this.call('GET', `/tasks/${taskId}`)) as RemoteTask;
      if (task.is_deleted) return null;
      return { done: !!task.checked || !!task.completed_at, content: String(task.content ?? ''), description: String(task.description ?? '') };
    } catch (error) {
      if (!isStatus(error, 404)) throw error;
    }
    // Not found as a task. Before calling it deleted, make sure it isn't simply completed.
    try {
      const until = new Date();
      const since = new Date(until.getTime() - 6 * 24 * 60 * 60 * 1000);
      const query = `since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}&limit=200`;
      const answer = (await this.call('GET', `/tasks/completed/by_completion_date?${query}`)) as { items?: RemoteTask[] };
      const found = (answer.items || []).find((t) => String(t.id) === taskId);
      if (found) return { done: true, content: String(found.content ?? ''), description: String(found.description ?? '') };
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
    return null;
  }

  private async call(method: string, path: string, body?: unknown, token: string | null = this.token): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new HttpError(response.status);
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  private save(): void {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
    } catch {
      /* bookkeeping is rebuilt from Todoist if it is lost */
    }
  }

  private setStatus(status: 'ok' | 'error'): void {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
