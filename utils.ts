import { ItemMap, WorkflowyState, Item } from './types';

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
        isTask: false,
      },
      [firstChildId]: {
        id: firstChildId,
        text: 'Welcome to Bulletpoints! Data is now shared across all devices/browsers.',
        children: [],
        isCompleted: false,
        collapsed: false,
        isTask: false,
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

export const linkifyHtml = (html: string): string => {
  // Create a temporary container to parse HTML
  const div = document.createElement('div');
  div.innerHTML = html;
  
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null);
  let node;
  const nodesToReplace: { node: Node, text: string }[] = [];
  
  // First pass: identify text nodes containing URLs
  while(node = walker.nextNode()) {
    // Skip if already inside an anchor tag
    if (node.parentElement?.tagName === 'A') continue;
    
    const text = node.nodeValue || '';
    // Regex matches http://, https://, or www.
    if (/((https?:\/\/|www\.)[^\s]+)/.test(text)) {
        nodesToReplace.push({ node, text });
    }
  }
  
  if (nodesToReplace.length === 0) return html;
  
  let changed = false;
  
  // Second pass: replace identified nodes
  nodesToReplace.forEach(({ node, text }) => {
     const fragment = document.createDocumentFragment();
     let lastIdx = 0;
     const urlRegex = /((?:https?:\/\/|www\.)[^\s]+)/g;
     let match;
     let localChange = false;
     
     while ((match = urlRegex.exec(text)) !== null) {
        localChange = true;
        
        // Append text before URL
        if (match.index > lastIdx) {
            fragment.appendChild(document.createTextNode(text.substring(lastIdx, match.index)));
        }
        
        // Create anchor tag
        const url = match[0];
        const a = document.createElement('a');
        const href = url.startsWith('www.') ? `http://${url}` : url;
        a.href = href;
        a.textContent = url;
        // Updated class list for dark mode compatibility
        a.className = "text-blue-500 dark:text-blue-400 underline hover:text-blue-600 dark:hover:text-blue-300 cursor-pointer";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = "Cmd+Click to open";
        
        fragment.appendChild(a);
        
        lastIdx = match.index + url.length;
     }
     
     if (localChange) {
         // Append remaining text
         if (lastIdx < text.length) {
             fragment.appendChild(document.createTextNode(text.substring(lastIdx)));
         }
         node.parentNode?.replaceChild(fragment, node);
         changed = true;
     }
  });
  
  return changed ? div.innerHTML : html;
};

export const exportToText = (items: ItemMap, rootId: string): string => {
  let output = '';
  
  const processList = (itemIds: string[], depth: number) => {
    for (const id of itemIds) {
      const item = items[id];
      if (!item) continue;
      
      const prefix = '-'.repeat(depth);
      const text = stripHtml(item.text); 
      
      output += `${prefix}${text}\n`;
      
      if (item.children.length > 0) {
        processList(item.children, depth + 1);
      }
    }
  };

  const root = items[rootId];
  if (root) {
    processList(root.children, 0);
  }
  
  return output.trim();
};

export const parseImportText = (text: string): WorkflowyState => {
  const rootId = INITIAL_ROOT_ID;
  const items: ItemMap = {
    [rootId]: {
      id: rootId,
      text: 'Home',
      children: [],
      isCompleted: false,
      collapsed: false,
      isTask: false,
    }
  };
  
  const lines = text.split(/\r?\n/);
  // Stack of parent IDs. index 0 = root.
  const parentStack = [rootId]; 
  
  lines.forEach(line => {
    // Skip entirely empty lines that might result from trailing newlines
    if (!line.trim() && line.length === 0) return;
    
    // Determine depth by counting leading hyphens
    const match = line.match(/^(-*)/);
    const depth = match ? match[1].length : 0;
    
    // Get content
    const content = line.substring(depth);
    
    // Generate Item
    const id = generateId();
    const newItem: Item = {
      id,
      text: content,
      children: [],
      isCompleted: false,
      collapsed: false,
      fontSize: 'small',
      isTask: false,
    };
    items[id] = newItem;
    
    // Find parent
    // If depth is 0, parent is root (stack[0]).
    // If depth is 1, parent is last item at depth 0 (stack[1]).
    let parentIndex = depth;
    if (parentIndex >= parentStack.length) {
        parentIndex = parentStack.length - 1;
    }
    const parentId = parentStack[parentIndex];
    
    if (items[parentId]) {
        items[parentId].children.push(id);
    }
    
    // Prepare for children of this item (which will be at depth + 1)
    parentStack[depth + 1] = id;
    parentStack.length = depth + 2; 
  });
  
  return { items, rootId };
};

// Helper to set cursor at specific character offset within a contentEditable element
export const setCaretPosition = (root: HTMLElement, offset: number) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  let currentOffset = 0;
  let found = false;

  const selection = window.getSelection();
  const range = document.createRange();

  while (node) {
    const length = node.nodeValue?.length || 0;
    if (currentOffset + length >= offset) {
      range.setStart(node, offset - currentOffset);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      found = true;
      break;
    }
    currentOffset += length;
    node = walker.nextNode();
  }

  // If offset is greater than content length, move to end
  if (!found) {
    range.selectNodeContents(root);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
};

// Helper to get caret text offset
export const getCaretCharacterOffsetWithin = (element: HTMLElement) => {
  let caretOffset = 0;
  const doc = element.ownerDocument || document;
  const win = doc.defaultView || window;
  const sel = win?.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    caretOffset = preCaretRange.toString().length;
  }
  return caretOffset;
};