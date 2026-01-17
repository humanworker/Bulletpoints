import { ItemMap, WorkflowyState } from './types';

export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

export const INITIAL_ROOT_ID = 'root';

export const getInitialState = (): WorkflowyState => {
  const saved = localStorage.getItem('minflow-data');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse saved state', e);
    }
  }

  // Default initial state
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
        text: 'Welcome to MinFlow! Click the bullet to zoom.',
        children: [],
        isCompleted: false,
        collapsed: false,
      },
    },
    rootId: INITIAL_ROOT_ID,
  };
};

export const saveState = (state: WorkflowyState) => {
  localStorage.setItem('minflow-data', JSON.stringify(state));
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