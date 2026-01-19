
import React, { useState, useEffect, useRef } from 'react';
import { useBulletpoints } from './hooks/useBulletpoints';
import { BulletNode } from './components/BulletNode';
import { Breadcrumbs } from './components/Breadcrumbs';
import { INITIAL_ROOT_ID, getVisibleFlatList, generateId } from './utils';

const App: React.FC = () => {
  const { 
    loading,
    saveStatus,
    state, 
    items, 
    addItem, 
    updateText, 
    deleteItem,
    mergeUp,
    indent, 
    outdent, 
    toggleCollapse, 
    moveItems,
    undo,
    redo
  } = useBulletpoints();
  
  // View State
  const [currentRootId, setCurrentRootId] = useState<string>(INITIAL_ROOT_ID);
  
  // Focus State
  const [focusedId, setFocusedIdState] = useState<string | null>(null);
  const [focusOffset, setFocusOffset] = useState<number | null>(null);
  
  const setFocusedId = (id: string | null) => {
    setFocusedIdState(id);
    setFocusOffset(null);
  };

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Marquee Selection State
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null);
  const isSelectingRef = useRef(false);
  const initialSelectionRef = useRef<Set<string>>(new Set());

  // Global Keyboard Shortcuts (Undo/Redo)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd+Z or Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); 
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [undo, redo]);

  // Calculate visible items for navigation and range selection
  const visibleItems = React.useMemo(() => {
    return getVisibleFlatList(items, currentRootId);
  }, [items, currentRootId]);

  // Selection Handler (Simplified)
  const handleSelect = (id: string, shiftKey: boolean, metaKey: boolean, altKey: boolean) => {
    if (altKey) {
        toggleCollapse(id);
        return;
    }

    // Toggle selection with Meta/Ctrl
    if (metaKey || shiftKey) {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    } else {
        // Single click (without modifiers) usually just focuses, handled by BulletNode focus logic.
        // But if we want it to select the item explicitly:
        setSelectedIds(new Set([id]));
    }
  };

  const handleMultiLinePaste = (id: string, parentId: string, pastedText: string, prefix: string, suffix: string) => {
    const lines = pastedText.split(/\r\n|\r|\n/);
    if (lines.length === 0) return;
    
    // Update current item with the first line
    updateText(id, prefix + lines[0]);
    
    // If only one line (no newlines in paste), effectively just normal paste (though handled here)
    if (lines.length === 1) {
        // Append suffix if any
        updateText(id, prefix + lines[0] + suffix);
        return;
    }

    // Multiple lines
    let previousId = id;

    // lines 1..n are new items
    for (let i = 1; i < lines.length; i++) {
        const newId = generateId();
        let lineContent = lines[i];
        
        // If it's the last line, append suffix
        if (i === lines.length - 1) {
            lineContent += suffix;
        }
        
        // Add new item after previousId
        addItem(parentId, previousId, newId);
        updateText(newId, lineContent);
        
        previousId = newId;
        
        // Focus the last item
        if (i === lines.length - 1) {
            setFocusedId(newId);
        }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, parentId: string, selectionStart?: number | null, currentText?: string) => {
    // Clear selection on navigation if not holding modifiers
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && selectedIds.size > 0 && e.key.startsWith('Arrow')) {
        setSelectedIds(new Set());
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      
      // Handle Cmd/Ctrl + Enter to delete
      if (e.metaKey || e.ctrlKey) {
         const currentIndex = visibleItems.indexOf(id);
         if (currentIndex > 0) {
           setFocusedId(visibleItems[currentIndex - 1]);
         } else if (parentId !== currentRootId) {
            setFocusedId(parentId);
         }
        deleteItem(id, parentId);
        return;
      }
      
      // Split on Enter Logic
      const item = items[id];
      const text = currentText !== undefined ? currentText : (item?.text || '');
      const start = selectionStart !== undefined && selectionStart !== null ? selectionStart : text.length;

      const textBefore = text.slice(0, start);
      const textAfter = text.slice(start);

      // 1. Update text of current item if needed
      if (textBefore !== text) {
        updateText(id, textBefore);
      }
      
      // 2. Create new item
      const newId = generateId();
      if (item && item.children.length > 0 && !item.collapsed) {
        addItem(id, null, newId);
      } else {
        addItem(parentId, id, newId);
      }
      
      // 3. Update text of new item if needed
      if (textAfter) {
        updateText(newId, textAfter);
      }

      setFocusedIdState(newId);
      setFocusOffset(0); // Set cursor to start of new item
      setSelectedIds(new Set());
      
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        outdent(id, parentId);
      } else {
        indent(id, parentId);
      }
    } else if (e.key === 'Backspace') {
      // Logic for merging items or deleting
      const isCollapsed = window.getSelection()?.isCollapsed;
      
      // Case 1: Cursor at start, Previous Item exists -> Merge
      if (selectionStart === 0 && isCollapsed) {
          const currentIndex = visibleItems.indexOf(id);
          if (currentIndex > 0) {
             const prevItemId = visibleItems[currentIndex - 1];
             const prevItem = items[prevItemId];
             if (prevItem) {
                 e.preventDefault();
                 const prevTextLength = prevItem.text.length;
                 
                 mergeUp(id, parentId, prevItemId);
                 
                 setFocusedId(prevItemId);
                 setFocusOffset(prevTextLength);
                 
                 // Clear selection just in case
                 setSelectedIds(new Set());
                 return;
             }
          }
      }
      
      // Case 2: Item empty (and presumably at top of list or some other edge case not caught above) -> Delete
      const item = items[id];
      if (item && item.text === '' && item.children.length === 0) {
        e.preventDefault();
        const currentIndex = visibleItems.indexOf(id);
        if (currentIndex > 0) {
          setFocusedId(visibleItems[currentIndex - 1]);
        } else if (parentId !== currentRootId) {
             setFocusedId(parentId);
        }
        deleteItem(id, parentId);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = visibleItems.indexOf(id);
      if (currentIndex > 0) {
        setFocusedId(visibleItems[currentIndex - 1]);
      } else if (currentIndex === 0 && parentId !== currentRootId && parentId !== INITIAL_ROOT_ID) {
         setFocusedId(parentId);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentIndex = visibleItems.indexOf(id);
      if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
        setFocusedId(visibleItems[currentIndex + 1]);
      }
    }
  };

  const handleZoom = (id: string) => {
    setCurrentRootId(id);
    setFocusedId(null);
    setSelectedIds(new Set());
  };

  const rootItem = items[currentRootId];

  useEffect(() => {
    if (!items[currentRootId] && currentRootId !== INITIAL_ROOT_ID) {
      setCurrentRootId(INITIAL_ROOT_ID);
    }
  }, [items, currentRootId]);

  // --- Marquee Selection Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Allow dragging from anywhere EXCEPT interactive elements
    if (
        target.closest('textarea') || 
        target.closest('.cursor-move') || 
        target.closest('button') || 
        target.closest('a')
    ) {
      return;
    }

    // Crucial: Prevent default to stop text selection cursor
    e.preventDefault();

    isSelectingRef.current = true;
    
    // Clear browser text selection
    window.getSelection()?.removeAllRanges();
    
    selectionStartRef.current = { x: e.clientX, y: e.clientY };
    setSelectionRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });

    // If holding Shift/Meta, keep existing selection initially
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
        initialSelectionRef.current = new Set(selectedIds);
    } else {
        initialSelectionRef.current = new Set();
        setSelectedIds(new Set());
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelectingRef.current || !selectionStartRef.current) return;

    e.preventDefault(); // Prevent text selection while dragging

    const currentX = e.clientX;
    const currentY = e.clientY;
    const startX = selectionStartRef.current.x;
    const startY = selectionStartRef.current.y;

    const x = Math.min(currentX, startX);
    const y = Math.min(currentY, startY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    setSelectionRect({ x, y, width, height });

    // Only select if we have a minimal drag area
    if (width < 2 && height < 2) return;

    const selectionBox = { left: x, right: x + width, top: y, bottom: y + height };
    const nodes = document.querySelectorAll('.bullet-node-wrapper');
    const newSelected = new Set(initialSelectionRef.current);

    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      // Check intersection
      if (
        rect.left < selectionBox.right &&
        rect.right > selectionBox.left &&
        rect.top < selectionBox.bottom &&
        rect.bottom > selectionBox.top
      ) {
        const id = node.getAttribute('data-node-id');
        if (id) newSelected.add(id);
      }
    });

    setSelectedIds(newSelected);
  };

  const handleMouseUp = () => {
    isSelectingRef.current = false;
    setSelectionRect(null);
    selectionStartRef.current = null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg animate-pulse">Loading MinFlow...</div>
      </div>
    );
  }

  return (
    <div 
        className="w-full h-full bg-gray-50 flex flex-col relative overflow-hidden select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
    >
      {/* Selection Marquee */}
      {selectionRect && (
        <div 
          className="fixed border border-blue-500 bg-blue-400 bg-opacity-20 pointer-events-none z-50"
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height
          }}
        />
      )}

      {/* Main Content Container */}
      <div className="max-w-3xl mx-auto w-full h-full flex flex-col relative px-8 py-12">
          
          <div className="absolute top-4 right-8 text-xs font-mono">
            {saveStatus === 'saving' && <span className="text-yellow-600">Saving...</span>}
            {saveStatus === 'saved' && <span className="text-green-600 opacity-50">Saved</span>}
            {saveStatus === 'error' && <span className="text-red-600 font-bold">Error Saving</span>}
          </div>

          <Breadcrumbs 
            items={items} 
            currentRootId={currentRootId} 
            rootId={INITIAL_ROOT_ID} 
            onNavigate={handleZoom} 
          />

          <div className="flex-1 overflow-y-auto pb-20 pl-4"
               onMouseDown={(e) => {
                 // Ensure clicks in the empty area of the list start selection
                 if (e.target === e.currentTarget) handleMouseDown(e);
               }}
          >
            {rootItem && (
              <div className="">
                {currentRootId !== INITIAL_ROOT_ID && (
                  <h1 className="text-3xl font-bold mb-6 text-gray-900 outline-none"
                      onClick={(e) => { e.stopPropagation(); setFocusedId(currentRootId); setSelectedIds(new Set()); }}
                  >
                    {rootItem.text}
                  </h1>
                )}

                {rootItem.children.length === 0 && (
                  <div className="text-gray-400 italic mt-4 cursor-text" 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          const newId = generateId();
                          addItem(currentRootId, null, newId); 
                          setFocusedId(newId);
                          setSelectedIds(new Set());
                        }}>
                    Empty list. Press Enter to add an item.
                  </div>
                )}

                {rootItem.children.map((childId) => (
                  <BulletNode
                    key={childId}
                    id={childId}
                    items={items}
                    parentId={currentRootId}
                    focusedId={focusedId}
                    focusOffset={focusOffset}
                    selectedIds={selectedIds}
                    setFocusedId={setFocusedId}
                    onKeyDown={handleKeyDown}
                    onUpdateText={updateText}
                    onZoom={handleZoom}
                    onToggleCollapse={toggleCollapse}
                    onMoveItems={moveItems}
                    onSelect={handleSelect}
                    onMultiLinePaste={handleMultiLinePaste}
                  />
                ))}
              </div>
            )}
          </div>
          
          <div className="fixed bottom-4 right-4 text-xs text-gray-400 pointer-events-none text-right">
            <p>Click & Drag background to select items</p>
            <p>Cmd/Ctrl+Click bullet to collapse/expand</p>
            <p>Drag bullet point to move items</p>
            <p>Tab to indent, Shift+Tab to outdent</p>
          </div>
      </div>
    </div>
  );
};

export default App;
