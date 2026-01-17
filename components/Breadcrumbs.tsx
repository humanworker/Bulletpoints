import React from 'react';
import { ItemMap, Item } from '../types';

interface BreadcrumbsProps {
  items: ItemMap;
  currentRootId: string;
  rootId: string; // Absolute root
  onNavigate: (id: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  currentRootId,
  rootId,
  onNavigate,
}) => {
  const path: Item[] = [];
  let curr: string | null = currentRootId;

  // Build path backwards from current view to absolute root
  // (Note: finding parents in a flat map is slow O(N), for a production app we'd store parentId on the node)
  // For this simplified version we'll just scan.
  // Optimization: Since we need to traverse UP, and our struct is DOWN, we need a helper or parent ref.
  // Let's rely on a helper function in utils or just scan here since dataset is small.
  
  // To avoid O(N*Depth) in render, we can memoize or improve data structure. 
  // For MVP, we will do a quick scan.
  const findParent = (childId: string): string | null => {
    for (const id in items) {
      if (items[id].children.includes(childId)) return id;
    }
    return null;
  };

  while (curr && curr !== rootId) {
    if (items[curr]) {
      path.unshift(items[curr]);
      curr = findParent(curr);
    } else {
      break;
    }
  }
  
  // Add absolute root
  if (items[rootId]) {
    path.unshift(items[rootId]);
  }

  return (
    <nav className="flex items-center text-lg mb-6 text-gray-500">
      {path.map((item, index) => (
        <React.Fragment key={item.id}>
          {index > 0 && <span className="mx-2 text-gray-300">/</span>}
          <button
            onClick={() => onNavigate(item.id)}
            className={`hover:text-gray-800 transition-colors duration-200 ${
              item.id === currentRootId ? 'font-bold text-gray-900' : 'cursor-pointer'
            }`}
          >
            {item.id === rootId ? 'Home' : item.text || 'Untitled'}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
};
