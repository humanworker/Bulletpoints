import React, { useState, useEffect } from 'react';
import { useBulletpoints } from './hooks/useBulletpoints';
import { BulletNode } from './components/BulletNode';
import { Breadcrumbs } from './components/Breadcrumbs';
import { INITIAL_ROOT_ID, getVisibleFlatList, generateId } from './utils';

const App: React.FC = () => {
  const { 
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
    
    // If we select via bullet click, we might want to blur text focus?
    // Or keep focus? Keeping focus is fine.
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, parentId: string) => {
    // Clear selection on most keys unless Shift is held?
    // Actually, typing should probably clear selection if selection is elsewhere?
    // For now, let's just clear selection on basic nav if not selecting
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
      const newId = generateId();
      addItem(parentId, id, newId);
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

  // Click background to clear selection
  const handleBackgroundClick = () => {
    setSelectedIds(new Set());
  };

  return (
    <div 
        className="max-w-3xl mx-auto px-8 py-12 h-full flex flex-col"
        onClick={handleBackgroundClick}
    >
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
                   onClick={(e) => { e.stopPropagation(); setFocusedId(currentRootId); }}
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
                setFocusedId={setFocusedId}
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