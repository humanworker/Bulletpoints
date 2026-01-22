
import React, { useRef, useState, useEffect } from 'react';
import { ItemMap, Item } from '../types';
import { stripHtml } from '../utils';

interface BreadcrumbsProps {
  items: ItemMap;
  currentRootId: string;
  rootId: string; // Absolute root
  onNavigate: (id: string) => void;
  onRefresh?: () => void;
  rootClassName?: string;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  showHelp?: boolean;
  onToggleHelp?: () => void;
  onExport?: () => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  currentRootId,
  rootId,
  onNavigate,
  onRefresh,
  rootClassName,
  isDarkMode,
  onToggleTheme,
  showHelp,
  onToggleHelp,
  onExport,
}) => {
  const path: Item[] = [];
  let curr: string | null = currentRootId;
  const lastTapRef = useRef<number>(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

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

  const isAtRoot = currentRootId === rootId;

  // Close menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      // Close only if clicking outside the nav container
      if (navRef.current && !navRef.current.contains(target)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Reset menu when navigating away from root
  useEffect(() => {
    if (!isAtRoot) {
      setIsMenuOpen(false);
    }
  }, [isAtRoot]);

  return (
    <nav ref={navRef} className="flex items-center text-lg text-gray-500 dark:text-gray-400 w-full overflow-hidden whitespace-nowrap select-none relative">
      {path.map((item, index) => {
        const isLast = index === path.length - 1;
        const isRoot = index === 0;
        
        // "Menu" when at root level (to imply clickable options), "Home" when deep (to imply navigation back)
        const text = isRoot ? (isAtRoot ? 'Menu' : 'Home') : stripHtml(item.text) || 'Untitled';
        
        let buttonClassName = "transition-colors duration-200 truncate ";
        if (isRoot) {
            buttonClassName += "shrink-0 ";
            if (rootClassName) {
                buttonClassName += rootClassName + " ";
                buttonClassName += isLast ? 'font-bold' : 'cursor-pointer';
            } else {
                buttonClassName += isLast 
                  ? 'font-bold text-gray-900 dark:text-gray-100' 
                  : 'cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200';
            }
            // If we are at root, the Home button becomes a toggle, so it should be clickable
            if (isAtRoot) {
                buttonClassName += " cursor-pointer";
            }
        } else {
            buttonClassName += "shrink ";
            buttonClassName += isLast 
              ? 'font-bold text-gray-900 dark:text-gray-100' 
              : 'cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200';
        }

        const handleClick = (e: React.MouseEvent) => {
            if (isRoot && isAtRoot) {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
            } else {
                onNavigate(item.id);
            }
        };

        return (
          <React.Fragment key={item.id}>
            {index > 0 && <span className="mx-2 text-gray-300 dark:text-gray-600 shrink-0">/</span>}
            <button
              onClick={handleClick}
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
              title={text + (isRoot ? (isAtRoot ? ' (Click for menu)' : ' (Double-click to refresh)') : '')}
              className={buttonClassName}
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
      
      {/* Menu Items (Right Aligned) */}
      {isAtRoot && isMenuOpen && (
        <div className="ml-auto flex items-center gap-4 bg-gray-50 dark:bg-gray-900 pl-4">
            {onToggleHelp && (
                <button 
                    className="hidden md:block font-bold text-gray-900 hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 transition-colors cursor-pointer"
                    onClick={() => {
                        onToggleHelp();
                    }}
                >
                    {showHelp ? 'Hide Help' : 'Show Help'}
                </button>
            )}
            
            {onToggleTheme && (
                <button 
                    className="font-bold text-gray-900 hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 transition-colors cursor-pointer"
                    onClick={() => {
                      onToggleTheme();
                    }}
                >
                    {isDarkMode ? 'Light Theme' : 'Dark Theme'}
                </button>
            )}

            {onExport && (
                <button 
                    className="font-bold text-gray-900 hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 transition-colors cursor-pointer"
                    onClick={() => {
                        onExport();
                        setIsMenuOpen(false);
                    }}
                >
                    Export
                </button>
            )}
        </div>
      )}
    </nav>
  );
};
