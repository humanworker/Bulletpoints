import { useReducer, useEffect, useCallback, useState, useRef } from 'react';
import { doc, getDocFromServer, setDoc, onSnapshot, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { WorkflowyState, Action, DropPosition, SaveStatus, Item, ItemMap } from '../types';
import { generateId, getDefaultState, findParentId, isAncestor, getUserDocId, parseImportText, INITIAL_ROOT_ID } from '../utils';

// Internal history state wrapper
interface HistoryState {
  past: WorkflowyState[];
  present: WorkflowyState;
  future: WorkflowyState[];
  lastAction?: Action;
}

const reducer = (state: WorkflowyState, action: Action): WorkflowyState => {
  const { items } = state;

  switch (action.type) {
    case 'LOAD_STATE':
      return action.state;

    case 'REMOTE_MERGE':
      return { ...state, items: action.items };

    case 'ADD_ITEM': {
      const { afterId, parentId, newId: providedId } = action;
      const newId = providedId || generateId();
      const parent = items[parentId];
      
      if (!parent) return state;

      const newItems = { ...items };
      const newItem: Item = {
        id: newId,
        text: '',
        children: [],
        isCompleted: false,
        collapsed: false,
        fontSize: 'small',
        isTask: false,
        isShortcut: false,
      };

      newItems[newId] = newItem;
      
      const newChildren = [...parent.children];
      if (afterId) {
        const index = newChildren.indexOf(afterId);
        if (index !== -1) {
          newChildren.splice(index + 1, 0, newId);
        } else {
          newChildren.push(newId);
        }
      } else {
        newChildren.unshift(newId); // Add to start if no afterId
      }

      newItems[parentId] = { ...parent, children: newChildren };

      return { ...state, items: newItems };
    }

    case 'UPDATE_TEXT': {
      const { id, text } = action;
      if (!items[id]) return state;
      return {
        ...state,
        items: {
          ...items,
          [id]: { ...items[id], text },
        },
      };
    }

    case 'DELETE': {
      const { id, parentId } = action;
      if (!items[parentId]) return state;

      const newItems = { ...items };
      const parent = newItems[parentId];
      
      // Remove from parent
      newItems[parentId] = {
        ...parent,
        children: parent.children.filter((childId) => childId !== id),
      };

      // Recursive delete helper
      const deleteRecursive = (itemId: string) => {
        const item = newItems[itemId];
        if (item) {
          item.children.forEach(deleteRecursive);
          delete newItems[itemId];
        }
      };
      deleteRecursive(id);

      return { ...state, items: newItems };
    }

    case 'MERGE_UP': {
      const { id, parentId, previousItemId } = action;
      const item = items[id];
      const prevItem = items[previousItemId];
      const parent = items[parentId];

      if (!item || !prevItem || !parent) return state;

      const newItems = { ...items };
      
      // 1. Calculate new text for previous item
      const newPrevText = prevItem.text + item.text;

      if (parentId === previousItemId) {
         // Case: Merging child into parent (e.g. B into A)
         // Replace B with B's children in A's children list
         const childIndex = parent.children.indexOf(id);
         const newChildren = [...parent.children];
         newChildren.splice(childIndex, 1, ...item.children);
         
         newItems[parentId] = {
           ...parent,
           text: newPrevText,
           children: newChildren
         };
      } else {
         // Case: Merging into sibling or cousin (e.g. B into A, where A is above B)
         // 1. Remove from old parent
         newItems[parentId] = {
           ...parent,
           children: parent.children.filter(c => c !== id)
         };

         // 2. Append children and text to target (previous item)
         newItems[previousItemId] = {
            ...prevItem,
            text: newPrevText,
            children: [...prevItem.children, ...item.children],
            collapsed: false // Ensure expanded so moved children are visible
         };
      }
      
      // 3. Delete current item
      delete newItems[id];
      
      return { ...state, items: newItems };
    }

    case 'INDENT': {
      const { id, parentId } = action;
      const parent = items[parentId];
      if (!parent) return state;

      const index = parent.children.indexOf(id);
      if (index <= 0) return state; // Can't indent if first child

      const prevSiblingId = parent.children[index - 1];
      const prevSibling = items[prevSiblingId];

      const newItems = { ...items };
      
      // Remove from current parent
      newItems[parentId] = {
        ...parent,
        children: parent.children.filter((childId) => childId !== id),
      };

      // Add to new parent (prev sibling)
      newItems[prevSiblingId] = {
        ...prevSibling,
        children: [...prevSibling.children, id],
        collapsed: false, // Auto expand when indenting into it
      };

      return { ...state, items: newItems };
    }

    case 'OUTDENT': {
      const { id, parentId } = action;
      // We need the GRANDparent to outdent
      const grandParentId = findParentId(items, parentId);
      if (!grandParentId) return state; // Can't outdent from root

      const grandParent = items[grandParentId];
      const parent = items[parentId];

      const newItems = { ...items };
      const parentIndex = grandParent.children.indexOf(parentId);

      // Remove from parent
      newItems[parentId] = {
        ...parent,
        children: parent.children.filter((childId) => childId !== id),
      };

      // Add to grandparent after parent
      const newGrandParentChildren = [...grandParent.children];
      newGrandParentChildren.splice(parentIndex + 1, 0, id);
      
      newItems[grandParentId] = {
        ...grandParent,
        children: newGrandParentChildren,
      };

      return { ...state, items: newItems };
    }

    case 'TOGGLE_COLLAPSE': {
      const { id } = action;
      return {
        ...state,
        items: {
          ...items,
          [id]: { ...items[id], collapsed: !items[id].collapsed },
        },
      };
    }

    case 'MOVE': {
      // Re-use MOVE_ITEMS logic for single item
      const { dragId, targetId, position } = action;
      return reducer(state, { type: 'MOVE_ITEMS', dragIds: [dragId], targetId, position });
    }

    case 'MOVE_ITEMS': {
      const { dragIds, targetId, position } = action;
      
      const topLevelDragIds = dragIds.filter(id => {
        return !dragIds.some(otherId => otherId !== id && isAncestor(items, otherId, id));
      });

      if (topLevelDragIds.length === 0) return state;

      for (const id of topLevelDragIds) {
         if (id === targetId || isAncestor(items, id, targetId)) {
           return state;
         }
      }

      const newItems = { ...items };

      topLevelDragIds.forEach(id => {
        const parentId = findParentId(newItems, id);
        if (parentId) {
           const parent = newItems[parentId];
           newItems[parentId] = {
             ...parent,
             children: parent.children.filter(childId => childId !== id)
           };
        }
      });

      if (position === 'inside') {
        const target = newItems[targetId];
        newItems[targetId] = {
          ...target,
          children: [...target.children, ...topLevelDragIds],
          collapsed: false
        };
      } else {
        const targetParentId = findParentId(newItems, targetId);
        if (targetParentId) {
          const targetParent = newItems[targetParentId];
          const targetIndex = targetParent.children.indexOf(targetId);
          const newChildren = [...targetParent.children];
          
          if (position === 'before') {
            newChildren.splice(targetIndex, 0, ...topLevelDragIds);
          } else {
            newChildren.splice(targetIndex + 1, 0, ...topLevelDragIds);
          }

          newItems[targetParentId] = {
            ...targetParent,
            children: newChildren
          };
        }
      }

      return { ...state, items: newItems };
    }

    case 'CHANGE_FONT_SIZE': {
      const { id, size } = action;
      if (!items[id]) return state;
      return {
        ...state,
        items: {
          ...items,
          [id]: { ...items[id], fontSize: size },
        },
      };
    }
    
    case 'SET_IS_TASK': {
      const { id, isTask } = action;
      if (!items[id]) return state;
      return {
        ...state,
        items: {
          ...items,
          [id]: { ...items[id], isTask },
        },
      };
    }

    case 'TOGGLE_IS_SHORTCUT': {
      const { id } = action;
      if (!items[id]) return state;
      return {
        ...state,
        items: {
          ...items,
          [id]: { ...items[id], isShortcut: !items[id].isShortcut },
        },
      };
    }

    case 'TOGGLE_STYLE': {
      const { id, style } = action;
      if (!items[id]) return state;
      
      const propMap = {
        'bold': 'isBold',
        'italic': 'isItalic',
        'underline': 'isUnderlined'
      };
      const prop = propMap[style] as keyof Item;
      
      return {
        ...state,
        items: {
          ...items,
          [id]: { ...items[id], [prop]: !items[id][prop] }
        }
      };
    }

    default:
      return state;
  }
};

const historyReducer = (state: HistoryState, action: Action): HistoryState => {
  switch (action.type) {
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, state.past.length - 1);
      return {
        past: newPast,
        present: previous,
        future: [state.present, ...state.future],
        lastAction: undefined // Reset last action on history traversal
      };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      return {
        past: [...state.past, state.present],
        present: next,
        future: newFuture,
        lastAction: undefined
      };
    }
    case 'LOAD_STATE': {
      return {
        past: [],
        present: action.state,
        future: [],
        lastAction: undefined
      };
    }
    case 'REMOTE_MERGE': {
      // Another device changed the data; local undo history would revert their edits
      return {
        past: [],
        present: reducer(state.present, action),
        future: [],
        lastAction: action
      };
    }
    default: {
      const newPresent = reducer(state.present, action);
      
      // If state didn't change, don't update history
      if (newPresent === state.present) return state;

      // Merge consecutive text updates on the same item
      if (
        action.type === 'UPDATE_TEXT' &&
        state.lastAction?.type === 'UPDATE_TEXT' &&
        state.lastAction.id === action.id
      ) {
        return {
          ...state,
          present: newPresent,
          lastAction: action,
          future: [] // Clear future on new action
        };
      }

      // Standard history push
      return {
        past: [...state.past, state.present],
        present: newPresent,
        future: [],
        lastAction: action
      };
    }
  }
};

const LOCAL_STORAGE_KEY = 'bulletpoints-local-data';
const COLLECTION = 'bulletpoints-data';
const SAVE_DEBOUNCE_MS = 800;

const readLocalState = (): WorkflowyState | null => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkflowyState;
    return parsed && parsed.items && parsed.items[parsed.rootId] ? parsed : null;
  } catch (e) {
    console.error('Failed to parse local data', e);
    return null;
  }
};

// Value comparison of two items (used to diff local state against the server copy)
const itemsEqual = (a?: Item, b?: Item): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.text === b.text &&
    !!a.collapsed === !!b.collapsed &&
    !!a.isCompleted === !!b.isCompleted &&
    !!a.isTask === !!b.isTask &&
    !!a.isShortcut === !!b.isShortcut &&
    !!a.isBold === !!b.isBold &&
    !!a.isItalic === !!b.isItalic &&
    !!a.isUnderlined === !!b.isUnderlined &&
    (a.fontSize || 'small') === (b.fontSize || 'small') &&
    a.children.length === b.children.length &&
    a.children.every((c, i) => c === b.children[i])
  );
};

// Three-way merge: items edited locally since the last sync (local differs from base) keep the
// local version; everything else takes the server's version. Unchanged items keep their object identity.
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

export const useBulletpoints = () => {
  // Read the on-device copy once so the first frame can render real content
  const initialLocalRef = useRef<WorkflowyState | null | undefined>(undefined);
  if (initialLocalRef.current === undefined) {
    initialLocalRef.current = readLocalState();
  }
  const hadLocalData = initialLocalRef.current !== null;

  const [loading, setLoading] = useState(!hadLocalData);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  const [historyState, dispatch] = useReducer(historyReducer, null, () => ({
    past: [],
    present: initialLocalRef.current || getDefaultState(),
    future: [],
  }));

  const { present: state, past, future } = historyState;

  // Latest state, readable from async callbacks (snapshot listener, save timer)
  const stateRef = useRef(state);
  stateRef.current = state;

  // Items as we believe they exist on the server. Saves upload only the difference,
  // and incoming snapshots are three-way merged against it so local edits are never lost.
  const syncedItemsRef = useRef<ItemMap | null>(initialLocalRef.current?.items ?? null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWritesRef = useRef(0);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = stateRef.current;

    // 1. Local copy (instant startup + offline fallback)
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.error('Failed to save local data', e);
    }

    if (!db) {
      setSaveStatus('saved-local');
      return;
    }

    // 2. Firestore: only changed / deleted items, merged into the document
    const base = syncedItemsRef.current;
    if (base === null) return; // Not synced yet; the first snapshot triggers a save

    const updates: Record<string, Item | ReturnType<typeof deleteField>> = {};
    let changeCount = 0;
    for (const id in current.items) {
      if (!itemsEqual(current.items[id], base[id])) {
        updates[id] = current.items[id];
        changeCount++;
      }
    }
    for (const id in base) {
      if (!(id in current.items)) {
        updates[id] = deleteField();
        changeCount++;
      }
    }

    if (changeCount === 0) {
      if (pendingWritesRef.current === 0) setSaveStatus('saved');
      return;
    }

    syncedItemsRef.current = current.items;
    pendingWritesRef.current++;
    setSaveStatus('saving');

    setDoc(doc(db, COLLECTION, getUserDocId()), { items: updates, rootId: current.rootId }, { merge: true })
      .then(() => {
        pendingWritesRef.current--;
        if (pendingWritesRef.current === 0 && !saveTimerRef.current) setSaveStatus('saved');
      })
      .catch((error) => {
        pendingWritesRef.current--;
        console.error('Error saving to Firebase:', error);
        // Server state is now unknown: re-upload everything on the next save
        syncedItemsRef.current = {};
        setSaveStatus('error');
      });
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Merge a server copy of the items into local state
  const applyRemoteItems = useCallback((remoteItems: ItemMap, rootId: string) => {
    const base = syncedItemsRef.current;
    syncedItemsRef.current = remoteItems;

    if (base === null) {
      // First sync on a device with no local copy: take the server state as-is
      dispatch({ type: 'LOAD_STATE', state: { items: remoteItems, rootId } });
      return;
    }

    const { merged, changed } = mergeRemoteItems(stateRef.current.items, base, remoteItems);

    if (changed && merged[stateRef.current.rootId]) {
      dispatch({ type: 'REMOTE_MERGE', items: merged });
    }
    // Upload any local edits the server doesn't have yet
    scheduleSave();
  }, [scheduleSave]);

  // Live sync with Firestore (or local-only mode)
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const docRef = doc(db, COLLECTION, getUserDocId());
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        // With a local copy we already render instantly; only trust the server's view
        if (snap.metadata.fromCache && (hadLocalData || !snap.exists())) return;

        if (!snap.exists()) {
          // Nothing on the server yet: upload whatever we have (or a fresh default)
          if (syncedItemsRef.current === null) {
            dispatch({ type: 'LOAD_STATE', state: getDefaultState() });
          }
          syncedItemsRef.current = {};
          setLoading(false);
          scheduleSave();
          return;
        }

        const data = snap.data() as WorkflowyState;
        if (!data.items || !data.items[data.rootId || INITIAL_ROOT_ID]) return;
        applyRemoteItems(data.items, data.rootId || INITIAL_ROOT_ID);
        setLoading(false);
      },
      (error) => {
        console.error('Error syncing with Firebase:', error);
        setSaveStatus('error');
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [applyRemoteItems, scheduleSave, hadLocalData]);

  // Manual refresh: pull the latest server copy and merge it in
  const refreshData = useCallback(async () => {
    if (!db) return;
    try {
      const snap = await getDocFromServer(doc(db, COLLECTION, getUserDocId()));
      if (snap.exists()) {
        const data = snap.data() as WorkflowyState;
        if (data.items) applyRemoteItems(data.items, data.rootId || INITIAL_ROOT_ID);
      }
    } catch (error) {
      console.error('Error refreshing from Firebase:', error);
      setSaveStatus('error');
    }
  }, [applyRemoteItems]);

  // Debounced save whenever local state changes (but not for states that came from the server)
  const lastSeenStateRef = useRef(state);
  useEffect(() => {
    if (lastSeenStateRef.current === state) return;
    lastSeenStateRef.current = state;
    if (loading || historyState.lastAction?.type === 'REMOTE_MERGE') return;
    setSaveStatus('saving');
    scheduleSave();
  }, [state, loading, historyState.lastAction, scheduleSave]);

  // Flush immediately when the app goes to the background (it may be killed there)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && saveTimerRef.current) flushSave();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleVisibility);
    };
  }, [flushSave]);

  const addItem = useCallback((parentId: string, afterId: string | null, newId?: string) => {
    dispatch({ type: 'ADD_ITEM', parentId, afterId, newId });
  }, []);

  const updateText = useCallback((id: string, text: string) => {
    dispatch({ type: 'UPDATE_TEXT', id, text });
  }, []);

  const deleteItem = useCallback((id: string, parentId: string) => {
    dispatch({ type: 'DELETE', id, parentId });
  }, []);
  
  const mergeUp = useCallback((id: string, parentId: string, previousItemId: string) => {
    dispatch({ type: 'MERGE_UP', id, parentId, previousItemId });
  }, []);

  const indent = useCallback((id: string, parentId: string) => {
    dispatch({ type: 'INDENT', id, parentId });
  }, []);

  const outdent = useCallback((id: string, parentId: string) => {
    dispatch({ type: 'OUTDENT', id, parentId });
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_COLLAPSE', id });
  }, []);

  const moveItem = useCallback((dragId: string, targetId: string, position: DropPosition) => {
    dispatch({ type: 'MOVE', dragId, targetId, position });
  }, []);

  const moveItems = useCallback((dragIds: string[], targetId: string, position: DropPosition) => {
    dispatch({ type: 'MOVE_ITEMS', dragIds, targetId, position });
  }, []);

  const changeFontSize = useCallback((id: string, size: 'small' | 'medium' | 'large') => {
    dispatch({ type: 'CHANGE_FONT_SIZE', id, size });
  }, []);
  
  const setIsTask = useCallback((id: string, isTask: boolean) => {
    dispatch({ type: 'SET_IS_TASK', id, isTask });
  }, []);
  
  const toggleIsShortcut = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_IS_SHORTCUT', id });
  }, []);

  const toggleStyle = useCallback((id: string, style: 'bold' | 'italic' | 'underline') => {
    dispatch({ type: 'TOGGLE_STYLE', id, style });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const importFromText = useCallback((text: string) => {
      const newState = parseImportText(text);
      dispatch({ type: 'LOAD_STATE', state: newState });
  }, []);

  return {
    loading,
    saveStatus,
    state,
    items: state.items,
    addItem,
    updateText,
    deleteItem,
    mergeUp,
    indent,
    outdent,
    toggleCollapse,
    moveItem,
    moveItems,
    changeFontSize,
    setIsTask,
    toggleIsShortcut,
    toggleStyle,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    refreshData,
    importFromText,
  };
};