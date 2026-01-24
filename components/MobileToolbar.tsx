
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ItemMap, DropPosition } from '../types';
import { findParentId } from '../utils';

interface MobileToolbarProps {
  focusedId: string | null;
  items: ItemMap;
  visibleItems: string[];
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onIndent: (id: string, parentId: string) => void;
  onOutdent: (id: string, parentId: string) => void;
  onDelete: (id: string, parentId: string) => void;
  onToggleCollapse: (id: string) => void;
  setFocusedId: (id: string | null) => void;
}

export const MobileToolbar: React.FC<MobileToolbarProps> = ({
  focusedId,
  items,
  visibleItems,
  undo,
  redo,
  canUndo,
  canRedo,
  onIndent,
  onOutdent,
  onDelete,
  onToggleCollapse,
  setFocusedId
}) => {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset delete confirmation if focus changes
  useEffect(() => {
    setIsConfirmingDelete(false);
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    return () => {
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    };
  }, [focusedId]);

  const mobileActionStates = useMemo(() => {
    if (!focusedId || !items[focusedId]) {
      return { canIndent: false, canOutdent: false, canExpand: false, canCollapse: false };
    }

    const item = items[focusedId];
    const parentId = findParentId(items, focusedId);
    
    let canIndent = false;
    if (parentId && items[parentId]) {
      const index = items[parentId].children.indexOf(focusedId);
      canIndent = index > 0;
    }

    let canOutdent = false;
    if (parentId) {
      const grandParentId = findParentId(items, parentId);
      canOutdent = !!grandParentId;
    }

    const hasChildren = item.children.length > 0;
    const canExpand = hasChildren && item.collapsed;
    const canCollapse = hasChildren && !item.collapsed;

    return { canIndent, canOutdent, canExpand, canCollapse };
  }, [focusedId, items]);

  const handleMobileAction = (action: 'indent' | 'outdent' | 'delete' | 'expand' | 'collapse') => {
    if (!focusedId) return;

    // Handle Delete Confirmation
    if (action === 'delete') {
      if (!isConfirmingDelete) {
        setIsConfirmingDelete(true);
        if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
        deleteTimeoutRef.current = setTimeout(() => {
          setIsConfirmingDelete(false);
          deleteTimeoutRef.current = null;
        }, 1000);
        return; 
      } else {
        setIsConfirmingDelete(false);
        if (deleteTimeoutRef.current) {
          clearTimeout(deleteTimeoutRef.current);
          deleteTimeoutRef.current = null;
        }
      }
    } else {
      if (isConfirmingDelete) {
        setIsConfirmingDelete(false);
        if (deleteTimeoutRef.current) {
          clearTimeout(deleteTimeoutRef.current);
          deleteTimeoutRef.current = null;
        }
      }
    }

    const parentId = findParentId(items, focusedId);

    if (action === 'delete' && parentId) {
        // Handle focus before deleting
        const currentIndex = visibleItems.indexOf(focusedId);
        if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
           setFocusedId(visibleItems[currentIndex + 1]);
        } else if (currentIndex > 0) {
           setFocusedId(visibleItems[currentIndex - 1]);
        }
        onDelete(focusedId, parentId);
    } else if (action === 'indent' && parentId && mobileActionStates.canIndent) {
        onIndent(focusedId, parentId);
    } else if (action === 'outdent' && parentId && mobileActionStates.canOutdent) {
        onOutdent(focusedId, parentId);
    } else if ((action === 'expand' && mobileActionStates.canExpand) || (action === 'collapse' && mobileActionStates.canCollapse)) {
        onToggleCollapse(focusedId);
    }
  };

  return (
    <div className={`fixed bottom-[max(10px,env(safe-area-inset-bottom))] left-1/2 transform -translate-x-1/2 bg-black dark:bg-gray-800 dark:border dark:border-gray-700 rounded-full px-5 py-3 flex items-center gap-6 shadow-lg z-50 md:hidden transition-all duration-200 ${focusedId ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
      <button 
          onMouseDown={(e) => { e.preventDefault(); handleMobileAction('outdent'); }}
          disabled={!mobileActionStates.canOutdent}
          className={`transition-all ${mobileActionStates.canOutdent ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 21V3"/>
              <path d="M22 12H11"/>
              <path d="M15 8l-4 4 4 4"/>
          </svg>
      </button>
      
      <button 
          onMouseDown={(e) => { e.preventDefault(); handleMobileAction('indent'); }}
          disabled={!mobileActionStates.canIndent}
          className={`transition-all ${mobileActionStates.canIndent ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 21V3"/>
              <path d="M3 12h11"/>
              <path d="M10 8l4 4-4 4"/>
          </svg>
      </button>

      <button 
          onMouseDown={(e) => { e.preventDefault(); handleMobileAction('delete'); }}
          className={`transition-all ${isConfirmingDelete ? 'text-red-600 opacity-100 scale-110' : 'text-white opacity-80 hover:opacity-100 active:scale-90'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18"/>
              <path d="m6 6 12 12"/>
          </svg>
      </button>

      <button 
          onMouseDown={(e) => { e.preventDefault(); undo(); }}
          disabled={!canUndo}
          className={`transition-all ${canUndo ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6"/>
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
      </button>

      <button 
          onMouseDown={(e) => { e.preventDefault(); redo(); }}
          disabled={!canRedo}
          className={`transition-all ${canRedo ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6"/>
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7"/>
          </svg>
      </button>

      <button 
          onMouseDown={(e) => { e.preventDefault(); handleMobileAction('expand'); }}
          disabled={!mobileActionStates.canExpand}
          className={`transition-all ${mobileActionStates.canExpand ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 15 5 5 5-5"/>
              <path d="m7 9 5-5 5 5"/>
          </svg>
      </button>

      <button 
          onMouseDown={(e) => { e.preventDefault(); handleMobileAction('collapse'); }}
          disabled={!mobileActionStates.canCollapse}
          className={`transition-all ${mobileActionStates.canCollapse ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
      >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 20 5-5 5 5"/>
              <path d="m7 4 5 5 5-5"/>
          </svg>
      </button>
    </div>
  );
};
