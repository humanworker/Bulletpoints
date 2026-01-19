import { ItemMap, WorkflowyState } from './types';

export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

export const INITIAL_ROOT_ID = 'root';

// Get the shared Document ID for Firestore
// Using a static ID ensures all users/browsers engage with the same data
export const getUserDocId = (): string => {
  return 'bulletpoints-shared-workspace';
};

// Default seed state for new users
export const getDefaultState = (): WorkflowyState => {
  const firstChildId = generateId();
  return {
    items: {
      [INITIAL_ROOT_ID]: {
        id: INITIAL_ROOT_ID,
        text: 'Home',
        children: [firstChildId],
        isCompleted: false,
        collapsed: false,
      },
      [firstChildId]: {
        id: firstChildId,
        text: 'Welcome to Bulletpoints! Data is now shared across all devices/browsers.',
        children: [],
        isCompleted: false,
        collapsed: false,
      },
    },
    rootId: INITIAL_ROOT_ID,
  };
};

// Helper to find parent of a node (expensive in flat map, but reliable)
export const findParentId = (items: ItemMap, childId: string): string | null => {
  for (const id in items) {
    if (items[id].children.includes(childId)) {
      return id;
    }
  }
  return null;
};

// Check if possibleParent is actually a child of childId (to prevent cycles)
export const isAncestor = (items: ItemMap, possibleAncestorId: string, childId: string): boolean => {
  // Direct check
  if (possibleAncestorId === childId) return true;
  
  const child = items[childId];
  if (!child || child.children.length === 0) return false;

  // BFS or DFS to check if possibleAncestorId exists in child's subtree
  const stack = [...child.children];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === possibleAncestorId) return true;
    const current = items[currentId];
    if (current) {
      stack.push(...current.children);
    }
  }
  
  return false;
};

// Flatten tree to a list of visible IDs for keyboard navigation
export const getVisibleFlatList = (
  items: ItemMap,
  rootId: string,
  list: string[] = []
): string[] => {
  const root = items[rootId];
  if (!root) return list;

  // Don't include the root itself in the navigation list usually, 
  // but for the recursive function we iterate children
  for (const childId of root.children) {
    list.push(childId);
    const child = items[childId];
    if (child && !child.collapsed && child.children.length > 0) {
      getVisibleFlatList(items, childId, list);
    }
  }
  return list;
};

export const stripHtml = (html: string): string => {
  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || '';
};