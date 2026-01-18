
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

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
        e.preventDefault(); // Prevent browser native undo which might conflict with our controlled inputs
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

  // Selection Handler
  const handleSelect = (id: string, shiftKey: boolean, metaKey: boolean, altKey: boolean) => {
    if (altKey) {
        toggleCollapse(id);
        return;
    }

    const newSelected = new Set(metaKey ? selectedIds : []);
    
    if (shiftKey && (lastSelectedId || focusedId)) {
        const startId = lastSelectedId || focusedId!;
        const startIndex = visibleItems.indexOf(startId);
        const endIndex = visibleItems.indexOf(id);
        
        if (startIndex !== -1 && endIndex !== -1) {
            const start = Math.min(startIndex, endIndex);
            const end = Math.max(startIndex, endIndex);
            for (let i = start; i <= end; i++) {
                newSelected.add(visibleItems[i]);
            }
        } else {
            newSelected.add(id);
        }
    } else {
        if (metaKey) {
            if (newSelected.has(id)) {
                newSelected.delete(id);
            } else {
                newSelected.add(id);
            }
        } else {
            // Should not happen via BulletNode calls (we only call if modifier exists)
            // But if we did allow single click select:
            newSelected.add(id);
        }
    }

    setSelectedIds(newSelected);
    setLastSelectedId(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, parentId: string) => {
    // Clear selection on most keys unless Shift is held?
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
      
      // Regular Enter to add item
      const item = items[id];
      const newId = generateId();
      
      // If the item has children and is expanded, add the new item as the first child
      if (item && item.children.length > 0 && !item.collapsed) {
        addItem(id, null, newId);
      } else {
        // Otherwise add as the next sibling
        addItem(parentId, id, newId);
      }

      setFocusedId(newId);
      setSelectedIds(new Set());
      
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        outdent(id, parentId);
      } else {
        indent(id, parentId);
      }
    } else if (e.key === 'Backspace') {
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
    // Don't start selection if clicking on interactive elements
    if (target.closest('textarea') || target.closest('.cursor-move') || target.closest('button') || target.closest('a')) {
      return;
    }

    isSelectingRef.current = true;
    selectionStartRef.current = { x: e.clientX, y: e.clientY };
    setSelectionRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });

    if (e.shiftKey || e.metaKey || e.ctrlKey) {
        initialSelectionRef.current = new Set(selectedIds);
    } else {
        initialSelectionRef.current = new Set();
        setSelectedIds(new Set());
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelectingRef.current || !selectionStartRef.current) return;

    const currentX = e.clientX;
    const currentY = e.clientY;
    const startX = selectionStartRef.current.x;
    const startY = selectionStartRef.current.y;

    const x = Math.min(currentX, startX);
    const y = Math.min(currentY, startY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    setSelectionRect({ x, y, width, height });

    // Performance optimization: only run collision logic if we've moved a bit
    if (width < 2 && height < 2) return;

    const selectionBox = { left: x, right: x + width, top: y, bottom: y + height };
    const nodes = document.querySelectorAll('.bullet-node-wrapper');
    const newSelected = new Set(initialSelectionRef.current);

    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
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
        className="max-w-3xl mx-auto px-8 py-12 h-full flex flex-col relative select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
    >
      {/* Selection Marquee */}
      {selectionRect && (
        <div 
          className="fixed border border-blue-400 bg-blue-200 bg-opacity-20 pointer-events-none z-50"
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height
          }}
        />
      )}

      <div className="absolute top-4 right-8 text-xs font-mono">
        {saveStatus === 'saving' && <span className="text-yellow-600">Saving...</span>}
        {saveStatus === 'saved' && <span className="text-green-600 opacity-50">Saved</span>}
        {saveStatus === 'error' && <span className="text-red-600 font-bold">Error Saving (Check Console)</span>}
      </div>

      <Breadcrumbs 
        items={items} 
        currentRootId={currentRootId} 
        rootId={INITIAL_ROOT_ID} 
        onNavigate={handleZoom} 
      />

      <div className="flex-1 overflow-y-auto pb-20 pl-4">
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
                selectedIds={selectedIds}
                setFocusedId={(id) => {
                    setFocusedId(id);
                    if (id) setSelectedIds(new Set());
                }}
                onKeyDown={handleKeyDown}
                onUpdateText={updateText}
                onZoom={handleZoom}
                onToggleCollapse={toggleCollapse}
                onMoveItems={moveItems}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </div>
      
      <div className="fixed bottom-4 right-4 text-xs text-gray-400 pointer-events-none text-right">
        <p>Click & Drag background to select multiple</p>
        <p>Shift+Click bullet to range select</p>
        <p>Cmd/Ctrl+Click bullet to toggle select</p>
        <p>Alt+Click bullet to collapse/expand</p>
        <p>Drag multiple selected items to move</p>
        <p>Cmd/Ctrl+Enter to delete item</p>
        <p>Cmd/Ctrl+Z to undo, Shift+Cmd/Ctrl+Z to redo</p>
      </div>
    </div>
  );
};

export default App;
