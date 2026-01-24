import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { useBulletpoints } from './hooks/useBulletpoints';
import { BulletNode } from './components/BulletNode';
import { Breadcrumbs } from './components/Breadcrumbs';
import { INITIAL_ROOT_ID, getVisibleFlatList, generateId, stripHtml, findParentId, exportToText, getCaretCharacterOffsetWithin, setCaretPosition } from './utils';
import { Capacitor } from '@capacitor/core';
import { Item } from './types';

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
    changeFontSize,
    setIsTask,
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

  // Tasks Pane State
  const [showTasksPane, setShowTasksPane] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Effect to clear highlight after 3 seconds
  useEffect(() => {
    if (highlightedId) {
      const timer = setTimeout(() => setHighlightedId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedId]);

  // Derived tasks list
  const tasks = useMemo(() => Object.values(items).filter(i => i.isTask), [items]);

  const handleTaskClick = (task: Item) => {
    const parentId = findParentId(items, task.id);
    if (parentId) {
      // Navigate to parent
      setCurrentRootId(parentId);
      // Highlight the task
      setHighlightedId(task.id);
    }
  };

  const handleTaskCompleteInPane = (task: Item) => {
    const parentId = findParentId(items, task.id);
    if (parentId) {
      deleteItem(task.id, parentId);
    }
  };

  // Reset scroll when changing views
  useLayoutEffect(() => {
    isNavigatingRef.current = true;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    
    // Ensure scroll stays at top after layout/paint and prevent auto-scroll interference
    requestAnimationFrame(() => {
       if (scrollContainerRef.current) {
         scrollContainerRef.current.scrollTop = 0;
       }
       setTimeout(() => {
         isNavigatingRef.current = false;
       }, 150);
    });
  }, [currentRootId]);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bulletpoints-theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const newMode = !prev;
      localStorage.setItem('bulletpoints-theme', newMode ? 'dark' : 'light');
      return newMode;
    });
  };

  // Sync theme with body/html for overscroll areas
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Help State
  const [showHelp, setShowHelp] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bulletpoints-show-help');
      // Default to true
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

  // Sync Status Color Logic
  const [rootStatusColor, setRootStatusColor] = useState<string>('');
  const lastSavedTimeRef = useRef<number>(Date.now());

  // Delete Confirmation Logic
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Title Logic
  const titleRef = useRef<HTMLDivElement>(null);
  const restoreTitleCaretRef = useRef<number | null>(null);

  // Track the last time we were successfully saved
  useEffect(() => {
    if (saveStatus === 'saved') {
      lastSavedTimeRef.current = Date.now();
    }
  }, [saveStatus]);

  // Handle color transitions based on saveStatus
  useEffect(() => {
    let timeout: NodeJS.Timeout;

    if (saveStatus === 'saved') {
      // Only flash green if we are coming from a non-empty state (active saving/error)
      // and not during initial load
      if (!loading && rootStatusColor !== '') {
        setRootStatusColor('text-green-600 dark:text-green-400');
        timeout = setTimeout(() => {
          setRootStatusColor(''); // Return to default
        }, 3000);
      } else {
        // If we load the app and it's saved, just ensure it's default
        setRootStatusColor('');
      }
    } else if (saveStatus === 'saving') {
      // Check if we haven't already exceeded the 60s red threshold
      const elapsed = Date.now() - lastSavedTimeRef.current;
      if (elapsed < 60000) {
        setRootStatusColor('text-orange-500');
      }
    } else if (saveStatus === 'error') {
      setRootStatusColor('text-red-600');
    }

    return () => clearTimeout(timeout);
  }, [saveStatus, loading]);

  // Watchdog timer for 60s delay rule
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

  // Keyboard Visibility & Auto-Scroll Logic
  useEffect(() => {
    const ensureCaretVisible = () => {
      if (isNavigatingRef.current) return;
      if (!window.visualViewport || !scrollContainerRef.current) return;
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      
      const range = selection.getRangeAt(0);
      
      // Get rect of current selection/caret relative to viewport
      const domRect = range.getBoundingClientRect();
      
      // Create a mutable copy since DOMRect properties are readonly
      const rect = {
          bottom: domRect.bottom,
          height: domRect.height,
          width: domRect.width,
          x: domRect.x,
          y: domRect.y
      };

      if (rect.height === 0 && rect.width === 0 && range.startContainer.nodeType === Node.ELEMENT_NODE) {
          // If range is collapsed and no rect, try the element itself (e.g. empty bullet)
          const el = range.startContainer as HTMLElement;
          const elRect = el.getBoundingClientRect();
          if (elRect) {
              // Create artificial rect at start of element
              rect.x = elRect.x;
              rect.y = elRect.y;
              rect.bottom = elRect.bottom;
          }
      }

      // We need to account for the mobile toolbar height (~60px) plus some padding
      // This ensures the text isn't hidden *behind* the toolbar that sits on top of the keyboard
      const toolbarHeight = 80; 
      
      // visualViewport.height is the height of the visible area (screen - keyboard)
      const viewportHeight = window.visualViewport.height;
      const visibleBottom = viewportHeight - toolbarHeight;

      // Check if caret bottom is below the visible safe area
      // Note: rect.bottom is coordinate relative to visual viewport top-left usually
      if (rect.bottom > visibleBottom) {
        const overflow = rect.bottom - visibleBottom;
        // Scroll the container to reveal the text
        // Use 'auto' behavior for typing responsiveness, 'smooth' for resize
        scrollContainerRef.current.scrollBy({ top: overflow, behavior: 'smooth' });
      }
    };

    // Listeners to trigger visibility check
    const handleResize = () => {
        // Wait a tick for layout to update after keyboard opens
        setTimeout(ensureCaretVisible, 100);
        setTimeout(ensureCaretVisible, 300); // Retry for slower devices
    };

    const handleInput = () => {
        // Check immediately while typing
        requestAnimationFrame(ensureCaretVisible);
    };
    
    // Attach listeners
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
        window.visualViewport.addEventListener('scroll', handleResize);
    }
    
    // Bubble up input events from contentEditable
    document.addEventListener('input', handleInput);
    
    // Also check on click/focus changes
    document.addEventListener('click', () => setTimeout(ensureCaretVisible, 100));

    return () => {
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', handleResize);
            window.visualViewport.removeEventListener('scroll', handleResize);
        }
        document.removeEventListener('input', handleInput);
    };
  }, []);

  // Reset delete confirmation if focus changes or component unmounts
  useEffect(() => {
    setIsConfirmingDelete(false);
    if (deleteTimeoutRef.current) {
      clearTimeout(deleteTimeoutRef.current);
    }
    return () => {
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }
    };
  }, [focusedId]);

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
        
        // If it is the last line, append suffix
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

  const handleSplit = (id: string, htmlBefore: string, htmlAfter: string) => {
      const item = items[id];
      if (!item) return;
      
      const parentId = Object.keys(items).find(key => items[key].children.includes(id));
      if (!parentId) return;

      // 1. Update text of current item
      updateText(id, htmlBefore);
      
      // 2. Create new item
      const newId = generateId();
      if (item && item.children.length > 0 && !item.collapsed) {
        addItem(id, null, newId);
      } else {
        addItem(parentId, id, newId);
      }
      
      // 3. Update text of new item
      updateText(newId, htmlAfter);

      setFocusedIdState(newId);
      setFocusOffset(0); // Set cursor to start of new item
      setSelectedIds(new Set());
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
         
         // Try to move focus to the item below
         if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
           setFocusedId(visibleItems[currentIndex + 1]);
         } else if (currentIndex > 0) {
           // Fallback to item above if no item below
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
                 
                 // We need the plain text length for the cursor position
                 const prevTextLength = stripHtml(prevItem.text).length;
                 
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
      // Check if text is empty or just has empty tags like <br> or <div></div>
      const plainText = stripHtml(item?.text || '');
      if (item && plainText === '' && item.children.length === 0) {
        e.preventDefault();
        
        const currentIndex = visibleItems.indexOf(id);
        
        // Try to move focus to the item below
        if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
           setFocusedId(visibleItems[currentIndex + 1]);
        } else if (currentIndex > 0) {
           // Fallback to item above if no item below
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
          // Add to top of list
          addItem(currentRootId, null, newId);
          setFocusedId(newId);
      } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          // Move focus to first item
          if (rootItem && rootItem.children.length > 0) {
              setFocusedId(rootItem.children[0]);
          }
      }
  };

  // Focus effect for title
  useEffect(() => {
    if (focusedId === currentRootId && titleRef.current) {
        titleRef.current.focus();
        // Restore caret if needed, otherwise end?
        if (restoreTitleCaretRef.current !== null) {
            setCaretPosition(titleRef.current, restoreTitleCaretRef.current);
            restoreTitleCaretRef.current = null;
        } 
    }
  }, [focusedId, currentRootId]);

  // Layout Effect for text sync (external updates or re-renders)
  useLayoutEffect(() => {
      if (titleRef.current && rootItem && titleRef.current.innerHTML !== rootItem.text) {
          titleRef.current.innerHTML = rootItem.text;
          if (focusedId === currentRootId && restoreTitleCaretRef.current !== null) {
             setCaretPosition(titleRef.current, restoreTitleCaretRef.current);
          }
      }
  }, [rootItem?.text, focusedId, currentRootId]);


  // --- Mobile Toolbar Logic ---

  const mobileActionStates = React.useMemo(() => {
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
        // First tap: Enter confirmation mode
        setIsConfirmingDelete(true);
        if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
        deleteTimeoutRef.current = setTimeout(() => {
          setIsConfirmingDelete(false);
          deleteTimeoutRef.current = null;
        }, 1000);
        return; // Don't delete yet
      } else {
        // Second tap within timeout: Proceed to delete
        setIsConfirmingDelete(false);
        if (deleteTimeoutRef.current) {
          clearTimeout(deleteTimeoutRef.current);
          deleteTimeoutRef.current = null;
        }
      }
    } else {
      // Any other action resets the delete confirmation
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
        deleteItem(focusedId, parentId);
    } else if (action === 'indent' && parentId && mobileActionStates.canIndent) {
        indent(focusedId, parentId);
    } else if (action === 'outdent' && parentId && mobileActionStates.canOutdent) {
        outdent(focusedId, parentId);
    } else if ((action === 'expand' && mobileActionStates.canExpand) || (action === 'collapse' && mobileActionStates.canCollapse)) {
        toggleCollapse(focusedId);
    }
  };

  // --- Marquee Selection Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Allow dragging from anywhere EXCEPT interactive elements
    if (
        target.closest('[contenteditable]') || 
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
      <div className={`flex items-center justify-center h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="text-gray-400 text-lg animate-pulse">Loading Bulletpoints...</div>
      </div>
    );
  }

  // Use the "dark" class on the outer div to trigger Tailwind's class mode
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

        {/* Header - Not Fixed, Flex Item */}
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

        {/* Tasks Pane (Desktop Only) */}
        {showTasksPane && (
            <div className="fixed top-24 left-8 bottom-8 w-56 overflow-y-auto hidden md:flex flex-col gap-3 z-30">
                <h2 className="font-bold text-gray-900 dark:text-gray-100 text-lg sticky top-0 bg-gray-50 dark:bg-gray-900 py-1">Tasks</h2>
                {tasks.length === 0 && <div className="text-gray-400 italic text-sm">No tasks found.</div>}
                {tasks.map(task => (
                <div key={task.id} className="flex items-start gap-2 group cursor-pointer hover:opacity-80" onClick={() => handleTaskClick(task)}>
                    <input 
                    type="checkbox" 
                    className="mt-1 appearance-none w-3.5 h-3.5 border border-gray-400 dark:border-gray-500 rounded-sm bg-transparent checked:bg-blue-500 checked:border-blue-500 cursor-pointer shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleTaskCompleteInPane(task); }}
                    />
                    <div className="text-sm text-gray-700 dark:text-gray-300 font-medium line-clamp-3">
                        {stripHtml(task.text) || 'Untitled'}
                    </div>
                </div>
                ))}
            </div>
        )}

        {/* Main Content Area - Flex Grow, Scrolls Internally */}
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
                    onDelete={deleteItem}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mobile Toolbar */}
        <div className={`fixed bottom-[max(10px,env(safe-area-inset-bottom))] left-1/2 transform -translate-x-1/2 bg-black dark:bg-gray-800 dark:border dark:border-gray-700 rounded-full px-5 py-3 flex items-center gap-6 shadow-lg z-50 md:hidden transition-all duration-200 ${focusedId ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
          <button 
              onMouseDown={(e) => { e.preventDefault(); handleMobileAction('outdent'); }}
              disabled={!mobileActionStates.canOutdent}
              className={`transition-all ${mobileActionStates.canOutdent ? 'text-white opacity-80 hover:opacity-100 active:scale-90' : 'text-gray-600 dark:text-gray-500 cursor-not-allowed opacity-50'}`}
          >
              {/* Outdent Icon (Arrow Left to Line) */}
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
              {/* Indent Icon (Arrow Right to Line) */}
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
              {/* Delete Icon (X) */}
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
              {/* Undo Icon */}
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
              {/* Redo Icon */}
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
              {/* Expand Icon (Chevrons Out) */}
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
              {/* Collapse Icon (Chevrons In) */}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m7 20 5-5 5 5"/>
                  <path d="m7 4 5 5 5-5"/>
              </svg>
          </button>
        </div>
        
        {/* Help / Footer - Hidden on Mobile */}
        {showHelp && (
        <div className="fixed bottom-4 right-8 text-xs text-gray-400 dark:text-gray-500 pointer-events-none text-right hidden md:block">
          <p>Click & Drag background to select items</p>
          <p>Cmd/Ctrl+Click bullet to collapse/expand</p>
          <p>Drag bullet point to move items</p>
          <p>Type /t to turn item into task</p>
          <p>Tab to indent, Shift+Tab to outdent</p>
          <p>Cmd+B/I/U to format text</p>
          <p>Cmd+1/2/3 to change text size</p>
        </div>
        )}
      </div>
    </div>
  );
};

export default App;