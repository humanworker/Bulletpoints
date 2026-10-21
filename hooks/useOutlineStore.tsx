import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { ItemMap, DropPosition } from '../types';

// Everything a BulletNode needs to render. Nodes subscribe to just their own slice,
// so a keystroke in one bullet only re-renders that bullet instead of the whole tree.
export interface OutlineView {
  items: ItemMap;
  focusedId: string | null;
  focusOffset: number | null;
  focusNonce: number;
  selectedIds: Set<string>;
  highlightedId: string | null;
  draggingIds: Set<string> | null;
}

export interface OutlineStore {
  get: () => OutlineView;
  set: (view: OutlineView) => void;
  notify: () => void;
  subscribe: (listener: () => void) => () => void;
}

export const createOutlineStore = (initial: OutlineView): OutlineStore => {
  let view = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    set: (next) => {
      view = next;
    },
    notify: () => listeners.forEach((listener) => listener()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const OutlineStoreContext = createContext<OutlineStore | null>(null);

export const useOutlineStore = (): OutlineStore => {
  const store = useContext(OutlineStoreContext);
  if (!store) throw new Error('OutlineStoreContext is missing');
  return store;
};

// Selector must return a primitive or a stable reference (e.g. an item object)
export const useOutline = <T,>(selector: (view: OutlineView) => T): T => {
  const store = useOutlineStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
};

// Stable callbacks shared by every BulletNode (they always call the latest App handlers)
export interface BulletActions {
  setFocusedId: (id: string | null) => void;
  onKeyDown: (e: React.KeyboardEvent, id: string, parentId: string, selectionStart?: number | null) => void;
  onBackspace: (id: string, parentId: string, selectionStart: number) => boolean;
  onSplit: (id: string, htmlBefore: string, htmlAfter: string) => void;
  onUpdateText: (id: string, text: string) => void;
  onZoom: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onMoveItems: (dragIds: string[], targetId: string, position: DropPosition) => void;
  onMultiLinePaste: (id: string, parentId: string, text: string, prefix: string, suffix: string) => void;
  onChangeFontSize: (id: string, size: 'small' | 'medium' | 'large') => void;
  onSetIsTask: (id: string, isTask: boolean) => void;
  onToggleIsShortcut: (id: string) => void;
  onToggleStyle: (id: string, style: 'bold' | 'italic' | 'underline') => void;
  onCompleteTask: (id: string, parentId: string) => void;
  onIndent: (id: string, parentId: string) => void;
  onOutdent: (id: string, parentId: string) => void;
  onBulletPointerDown: (e: React.PointerEvent, id: string) => void;
  consumeDragClick: () => boolean;
}

export const BulletActionsContext = createContext<BulletActions | null>(null);

export const useBulletActions = (): BulletActions => {
  const actions = useContext(BulletActionsContext);
  if (!actions) throw new Error('BulletActionsContext is missing');
  return actions;
};
