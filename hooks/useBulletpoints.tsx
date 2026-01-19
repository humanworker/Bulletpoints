
import { useReducer, useEffect, useCallback, useState, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ItemMap, WorkflowyState, Action, DropPosition, SaveStatus, Item } from '../types';
import { generateId, getDefaultState, findParentId, isAncestor, getUserDocId } from '../utils';

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

export const useBulletpoints = () => {
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const isInitialLoad = useRef(true);

  const [historyState, dispatch] = useReducer(historyReducer, null, () => {
    // Start with a skeleton, content will load async
    return {
      past: [],
      present: getDefaultState(),
      future: [],
    };
  });

  const { present: state } = historyState;

  // Load Data Effect
  useEffect(() => {
    const loadData = async () => {
      // 1. Fallback to Local Storage if Firebase is not configured
      if (!db) {
        const localData = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (localData) {
          try {
            dispatch({ type: 'LOAD_STATE', state: JSON.parse(localData) });
          } catch (e) {
            console.error('Failed to parse local data', e);
            dispatch({ type: 'LOAD_STATE', state: getDefaultState() });
          }
        } else {
          dispatch({ type: 'LOAD_STATE', state: getDefaultState() });
        }
        setLoading(false);
        isInitialLoad.current = false;
        return;
      }

      // 2. Firebase Load
      try {
        const docId = getUserDocId();
        const docRef = doc(db, 'bulletpoints-data', docId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data() as WorkflowyState;
          dispatch({ type: 'LOAD_STATE', state: data });
        } else {
          // New user, save default state immediately so it exists next time
          const defaultState = getDefaultState();
          await setDoc(docRef, defaultState);
          dispatch({ type: 'LOAD_STATE', state: defaultState });
        }
      } catch (error) {
        console.error("Error loading data from Firebase:", error);
        // Fallback to local storage on error? For now just log it.
        // It's possible the user hasn't created the database yet.
      } finally {
        setLoading(false);
        // Small delay to prevent the save effect from firing immediately after load
        setTimeout(() => {
          isInitialLoad.current = false;
        }, 500);
      }
    };

    loadData();
  }, []);

  // Save Effect (Debounced)
  useEffect(() => {
    if (loading || isInitialLoad.current) return;

    setSaveStatus('saving');

    const save = async () => {
      // 1. Local Storage Save (always save to local as backup/fallback)
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));

      // 2. Firebase Save
      if (db) {
        try {
          const docId = getUserDocId();
          await setDoc(doc(db, 'bulletpoints-data', docId), state);
          setSaveStatus('saved');
        } catch (error) {
          console.error("Error saving to Firebase:", error);
          setSaveStatus('error');
        }
      } else {
        setSaveStatus('saved'); // Local storage only is still "saved"
      }
    };

    const timeoutId = setTimeout(save, 1000);
    return () => clearTimeout(timeoutId);
  }, [state, loading]);

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

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
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
    undo,
    redo,
  };
};
