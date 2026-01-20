
import React, { useRef } from 'react';
import { ItemMap, Item } from '../types';
import { stripHtml } from '../utils';

interface BreadcrumbsProps {
  items: ItemMap;
  currentRootId: string;
  rootId: string; // Absolute root
  onNavigate: (id: string) => void;
  onRefresh?: () => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  currentRootId,
  rootId,
  onNavigate,
  onRefresh,
}) => {
  const path: Item[] = [];
  let curr: string | null = currentRootId;
  const lastTapRef = useRef<number>(0);

  // Build path backwards from current view to absolute root
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
    <nav className="flex items-center text-lg text-gray-500 w-full overflow-hidden whitespace-nowrap select-none">
      {path.map((item, index) => {
        const isLast = index === path.length - 1;
        const isRoot = index === 0;
        const text = isRoot ? 'Home' : stripHtml(item.text) || 'Untitled';
        
        return (
          <React.Fragment key={item.id}>
            {index > 0 && <span className="mx-2 text-gray-300 shrink-0">/</span>}
            <button
              onClick={() => onNavigate(item.id)}
              onDoubleClick={(e) => {
                if (isRoot && onRefresh) {
                  e.preventDefault();
                  onRefresh();
                }
              }}
              onTouchEnd={(e) => {
                if (isRoot && onRefresh) {
                  const now = Date.now();
                  if (now - lastTapRef.current < 300) {
                    e.preventDefault();
                    onRefresh();
                  }
                  lastTapRef.current = now;
                }
              }}
              title={text + (isRoot ? ' (Double-click to refresh)' : '')}
              className={`hover:text-gray-800 transition-colors duration-200 truncate ${
                isLast 
                  ? 'font-bold text-gray-900 shrink' 
                  : 'cursor-pointer text-gray-500 hover:text-gray-700 shrink'
              } ${isRoot ? 'shrink-0' : ''}`}
              style={{
                // Intermediate items get a max-width to ensure they don't crowd out the current item or path structure
                // The current item (isLast) gets more room but will still truncate if needed
                maxWidth: isRoot ? 'none' : (isLast ? 'min(50vw, 400px)' : '120px'),
                minWidth: '20px'
              }}
            >
              {text}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};
