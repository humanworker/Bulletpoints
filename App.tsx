


import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { useBulletpoints } from './hooks/useBulletpoints';
import { BulletNode } from './components/BulletNode';
import { Breadcrumbs } from './components/Breadcrumbs';
import { TasksPane } from './components/TasksPane';
import { MobileToolbar } from './components/MobileToolbar';
import { INITIAL_ROOT_ID, getVisibleFlatList, generateId, stripHtml, exportToText, getCaretCharacterOffsetWithin, setCaretPosition } from './utils';
import { Capacitor } from '@capacitor/core';
import { useTheme } from './hooks/useTheme';
import { useVirtualKeyboard } from './hooks/useVirtualKeyboard';
import { useMarqueeSelection } from './hooks/useMarqueeSelection';

const App: React.FC = () => {
  const { 
    loading,
    saveStatus,
    items, 
    addItem, 
    updateText, 
    deleteItem,
    mergeUp,
    indent, 
    outdent, 
    toggleCollapse, 
    moveItems,
    changeFontSize,
    setIsTask,
    toggleStyle,
    undo,
    redo,
    canUndo,
    canRedo,
    refreshData
  } = useBulletpoints();
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);

  // View State
  const [currentRootId, setCurrentRootId] = useState<string>(INITIAL_ROOT_ID);
  const [showTasksPane, setShowTasksPane] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Clear highlight effect
  useEffect(() => {
    if (highlightedId) {
      const timer = setTimeout(() => setHighlightedId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedId]);

  // View Navigation Helpers
  const handleNavigateToTask = (parentId: string, taskId: string) => {
    setCurrentRootId(parentId);
    setHighlightedId(taskId);
  };

  // Reset scroll when changing views
  useLayoutEffect(() => {
    isNavigatingRef.current = true;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    requestAnimationFrame(() => {
       if (scrollContainerRef.current) {
         scrollContainerRef.current.scrollTop = 0;
       }
       setTimeout(() => {
         isNavigatingRef.current = false;
       }, 150);
    });
  }, [currentRootId]);
  
  // Hooks
  const { isDarkMode, toggleTheme } = useTheme();
  useVirtualKeyboard(scrollContainerRef, isNavigatingRef);

  // Help State
  const [showHelp, setShowHelp] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bulletpoints-show-help');
      return saved !== 'false';
    }
    return true;
  });

  const toggleHelp = () => {
    setShowHelp(prev => {
      const newState = !prev;
      localStorage.setItem('bulletpoints-show-help', newState ? 'true' : 'false');
      return newState;
    });
  };

  // Export Logic
  const handleExport = () => {
    const text = exportToText(items, currentRootId);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulletpoints_export_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Focus & Selection State
  const [focusedId, setFocusedIdState] = useState<string | null>(null);
  const [focusOffset, setFocusOffset] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setFocusedId = (id: string | null) => {
    setFocusedIdState(id);
    setFocusOffset(null);
  };

  // Marquee Selection Hook
  const { selectionRect, handleMouseDown, handleMouseMove, handleMouseUp } = useMarqueeSelection(selectedIds, setSelectedIds);

  // Sync Status Color Logic
  const [rootStatusColor, setRootStatusColor] = useState<string>('');
  const lastSavedTimeRef = useRef<number>(Date.now());

  // Title Logic
  const titleRef = useRef<HTMLDivElement>(null);
  const restoreTitleCaretRef = useRef<number | null>(null);

  useEffect(() => {
    if (saveStatus === 'saved') {
      lastSavedTimeRef.current = Date.now();
    }
  }, [saveStatus]);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (saveStatus === 'saved') {
      if (!loading && rootStatusColor !== '') {
        setRootStatusColor('text-green-600 dark:text-green-400');
        timeout = setTimeout(() => {
          setRootStatusColor('');
        }, 3000);
      } else {
        setRootStatusColor('');
      }
    } else if (saveStatus === 'saving') {
      const elapsed = Date.now() - lastSavedTimeRef.current;
      if (elapsed < 60000) {
        setRootStatusColor('text-orange-500');
      }
    } else if (saveStatus === 'error') {
      setRootStatusColor('text-red-600');
    }
    return () => clearTimeout(timeout);
  }, [saveStatus, loading]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (saveStatus !== 'saved') {
        const elapsed = Date.now() - lastSavedTimeRef.current;
        if (elapsed > 60000) {
          setRootStatusColor('text-red-600');
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [saveStatus]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
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

  // Calculate visible items for navigation
  const visibleItems = useMemo(() => {
    return getVisibleFlatList(items, currentRootId);
  }, [items, currentRootId]);

  const handleSelect = (id: string, shiftKey: boolean, metaKey: boolean, altKey: boolean) => {
    if (altKey) {
        toggleCollapse(id);
        return;
    }
    if (metaKey || shiftKey) {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    } else {
        setSelectedIds(new Set([id]));
    }
  };

  const handleMultiLinePaste = (id: string, parentId: string, pastedText: string, prefix: string, suffix: string) => {
    const lines = pastedText.split(/\r\n|\r|\n/);
    if (lines.length === 0) return;
    updateText(id, prefix + lines[0]);
    if (lines.length === 1) {
        updateText(id, prefix + lines[0] + suffix);
        return;
    }
    let previousId = id;
    for (let i = 1; i < lines.length; i++) {
        const newId = generateId();
        let lineContent = lines[i];
        if (i === lines.length - 1) {
            lineContent += suffix;
        }
        addItem(parentId, previousId, newId);
        updateText(newId, lineContent);
        previousId = newId;
        if (i === lines.length - 1) {
            setFocusedId(newId);
        }
    }
  };

  const handleSplit = (id: string, htmlBefore: string, htmlAfter: string) => {
      const item = items[id];
      if (!item) return;
      const parentId = Object.keys(items).find(key => items[key].children.includes(id));
      if (!parentId) return;
      updateText(id, htmlBefore);
      const newId = generateId();
      if (item && item.children.length > 0 && !item.collapsed) {
        addItem(id, null, newId);
      } else {
        addItem(parentId, id, newId);
      }
      updateText(newId, htmlAfter);
      setFocusedIdState(newId);
      setFocusOffset(0);
      setSelectedIds(new Set());
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, parentId: string, selectionStart?: number | null, currentText?: string) => {
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && selectedIds.size > 0 && e.key.startsWith('Arrow')) {
        setSelectedIds(new Set());
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
         const currentIndex = visibleItems.indexOf(id);
         if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
           setFocusedId(visibleItems[currentIndex + 1]);
         } else if (currentIndex > 0) {
           setFocusedId(visibleItems[currentIndex - 1]);
         } else if (parentId !== currentRootId) {
            setFocusedId(parentId);
         }
        deleteItem(id, parentId);
        return;
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        outdent(id, parentId);
      } else {
        indent(id, parentId);
      }
    } else if (e.key === 'Backspace') {
      const isCollapsed = window.getSelection()?.isCollapsed;
      if (selectionStart === 0 && isCollapsed) {
          const currentIndex = visibleItems.indexOf(id);
          if (currentIndex > 0) {
             const prevItemId = visibleItems[currentIndex - 1];
             const prevItem = items[prevItemId];
             if (prevItem) {
                 e.preventDefault();
                 const prevTextLength = stripHtml(prevItem.text).length;
                 mergeUp(id, parentId, prevItemId);
                 setFocusedId(prevItemId);
                 setFocusOffset(prevTextLength);
                 setSelectedIds(new Set());
                 return;
             }
          }
      }
      const item = items[id];
      const plainText = stripHtml(item?.text || '');
      if (item && plainText === '' && item.children.length === 0) {
        e.preventDefault();
        const currentIndex = visibleItems.indexOf(id);
        if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
           setFocusedId(visibleItems[currentIndex + 1]);
        } else if (currentIndex > 0) {
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

  // --- Title Handling ---
  const handleTitleInput = (e: React.FormEvent<HTMLDivElement>) => {
      const rawHtml = e.currentTarget.innerHTML;
      restoreTitleCaretRef.current = getCaretCharacterOffsetWithin(e.currentTarget);
      updateText(currentRootId, rawHtml);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          const newId = generateId();
          addItem(currentRootId, null, newId);
          setFocusedId(newId);
      } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (rootItem && rootItem.children.length > 0) {
              setFocusedId(rootItem.children[0]);
          }
      }
  };

  useEffect(() => {
    if (focusedId === currentRootId && titleRef.current) {
        titleRef.current.focus();
        if (restoreTitleCaretRef.current !== null) {
            setCaretPosition(titleRef.current, restoreTitleCaretRef.current);
            restoreTitleCaretRef.current = null;
        } 
    }
  }, [focusedId, currentRootId]);

  useLayoutEffect(() => {
      if (titleRef.current && rootItem && titleRef.current.innerHTML !== rootItem.text) {
          titleRef.current.innerHTML = rootItem.text;
          if (focusedId === currentRootId && restoreTitleCaretRef.current !== null) {
             setCaretPosition(titleRef.current, restoreTitleCaretRef.current);
          }
      }
  }, [rootItem?.text, focusedId, currentRootId]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="text-gray-400 text-lg animate-pulse">Loading Bulletpoints...</div>
      </div>
    );
  }

  return (
    <div className={isDarkMode ? 'dark h-full' : 'h-full'}>
      <div 
          className="h-full bg-gray-50 dark:bg-gray-900 flex flex-col relative select-none transition-colors duration-200"
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

        {/* Header */}
        <div className="flex-none w-full z-40 bg-gray-50/95 dark:bg-gray-900/95 border-b border-gray-200/50 dark:border-gray-800/50 pt-[env(safe-area-inset-top)]">
          <div className="max-w-3xl mx-auto w-full px-4 sm:px-8 py-4 relative">
              <Breadcrumbs 
                  items={items} 
                  currentRootId={currentRootId} 
                  rootId={INITIAL_ROOT_ID} 
                  onNavigate={handleZoom} 
                  onRefresh={refreshData}
                  rootClassName={rootStatusColor}
                  isDarkMode={isDarkMode}
                  onToggleTheme={toggleTheme}
                  showHelp={showHelp}
                  onToggleHelp={toggleHelp}
                  onExport={Capacitor.getPlatform() === 'android' ? undefined : handleExport}
                  showTasksPane={showTasksPane}
                  onToggleTasksPane={() => setShowTasksPane(!showTasksPane)}
              />
          </div>
        </div>

        {/* Tasks Pane */}
        {showTasksPane && (
            <TasksPane 
                items={items} 
                onNavigate={handleNavigateToTask}
                onCompleteTask={deleteItem}
            />
        )}

        {/* Main Content Area */}
        <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto w-full"
            onMouseDown={(e) => {
              // Ensure clicks in the empty area of the list start selection
              if (e.target === e.currentTarget) handleMouseDown(e);
            }}
        >
          <div className="max-w-3xl mx-auto w-full px-4 sm:px-8 pb-32 pt-6">
            {rootItem && (
              <div className="pl-1">
                {currentRootId !== INITIAL_ROOT_ID && (
                  <div 
                    ref={titleRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100 outline-none break-words empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
                    data-placeholder="Untitled"
                    onInput={handleTitleInput}
                    onKeyDown={handleTitleKeyDown}
                    onFocus={() => setFocusedId(currentRootId)}
                    onClick={(e) => {
                        e.stopPropagation();
                        setFocusedId(currentRootId);
                        setSelectedIds(new Set());
                    }}
                  />
                )}

                {rootItem.children.length === 0 && (
                  <div className="text-gray-400 dark:text-gray-500 italic mt-4 cursor-text" 
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
                    highlightedId={highlightedId}
                    setFocusedId={setFocusedId}
                    onKeyDown={handleKeyDown}
                    onSplit={handleSplit}
                    onUpdateText={updateText}
                    onZoom={handleZoom}
                    onToggleCollapse={toggleCollapse}
                    onMoveItems={moveItems}
                    onSelect={handleSelect}
                    onMultiLinePaste={handleMultiLinePaste}
                    onChangeFontSize={changeFontSize}
                    onSetIsTask={setIsTask}
                    onToggleStyle={toggleStyle}
                    onDelete={deleteItem}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <MobileToolbar 
            focusedId={focusedId}
            items={items}
            visibleItems={visibleItems}
            undo={undo}
            redo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onIndent={indent}
            onOutdent={outdent}
            onDelete={deleteItem}
            onToggleCollapse={toggleCollapse}
            setFocusedId={setFocusedId}
        />
        
        {/* Help Footer */}
        {showHelp && (
        <div className="fixed bottom-4 right-8 text-xs text-gray-400 dark:text-gray-500 pointer-events-none text-right hidden md:block">
          <p>Click & Drag background to select items</p>
          <p>Cmd/Ctrl+Click bullet to collapse/expand</p>
          <p>Drag bullet point to move items</p>
          <p>Tab to indent, Shift+Tab to outdent</p>
          <p>/t to toggle task</p>
          <p>/b, /i, /u to style</p>
          <p>/1, /2, /3 to resize</p>
        </div>
        )}
      </div>
    </div>
  );
};

export default App;