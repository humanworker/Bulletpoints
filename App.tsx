import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { useBulletpoints } from './hooks/useBulletpoints';
import { BulletNode } from './components/BulletNode';
import { Breadcrumbs } from './components/Breadcrumbs';
import { TasksPane } from './components/TasksPane';
import { ShortcutsPane } from './components/ShortcutsPane';
import { MobileToolbar } from './components/MobileToolbar';
import { ImportModal } from './components/ImportModal';
import { BottomSheet, SheetRow } from './components/BottomSheet';
import { Toast, ToastMessage } from './components/Toast';
import { INITIAL_ROOT_ID, getVisibleFlatList, generateId, stripHtml, exportToText, getCaretCharacterOffsetWithin, setCaretPosition, buildParentMap, isAncestor } from './utils';
import { isNative, isTouchDevice, haptic, openExternalUrl, shareTextFile, syncStatusBar, hideSplash } from './native';
import { useTheme } from './hooks/useTheme';
import { useVirtualKeyboard } from './hooks/useVirtualKeyboard';
import { useMarqueeSelection } from './hooks/useMarqueeSelection';
import { useTouchDrag } from './hooks/useTouchDrag';
import { createOutlineStore, OutlineStore, OutlineStoreContext, BulletActions, BulletActionsContext } from './hooks/useOutlineStore';

type Sheet = 'menu' | 'tasks' | 'shortcuts' | null;
type NavDirection = 'forward' | 'back';

// The zoomed-in item lives in the URL hash (#/<id>) so back/forward and reloads work
const getHashRootId = (): string | null => {
  const match = window.location.hash.match(/^#\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const urlForRoot = (id: string) =>
  id === INITIAL_ROOT_ID ? window.location.pathname + window.location.search : `#/${encodeURIComponent(id)}`;

// Slide between zoom levels where the View Transitions API is available
const runViewTransition = (update: () => void, direction: NavDirection) => {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduceMotion) {
    update();
    return;
  }
  document.documentElement.dataset.nav = direction;
  const transition = doc.startViewTransition(() => flushSync(update));
  transition.finished.finally(() => {
    delete document.documentElement.dataset.nav;
  });
};

const getActiveCaretOffset = (): number | null => {
  const el = document.activeElement as HTMLElement | null;
  return el && el.isContentEditable ? getCaretCharacterOffsetWithin(el) : null;
};

const blurActiveEditor = () => {
  const el = document.activeElement as HTMLElement | null;
  if (el?.isContentEditable) el.blur();
};

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
    moveItem,
    moveItems,
    changeFontSize,
    setIsTask,
    toggleIsShortcut,
    toggleStyle,
    undo,
    redo,
    canUndo,
    canRedo,
    refreshData,
    importFromText
  } = useBulletpoints();

  const isTouch = useMemo(() => isTouchDevice(), []);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // View State
  const [currentRootId, setCurrentRootId] = useState<string>(() => getHashRootId() ?? INITIAL_ROOT_ID);
  const currentRootIdRef = useRef(currentRootId);
  currentRootIdRef.current = currentRootId;

  const [showTasksPane, setShowTasksPane] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bulletpoints-show-tasks') === 'true';
    } catch {
      return false;
    }
  });

  const [showShortcutsPane, setShowShortcutsPane] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bulletpoints-show-shortcuts') === 'true';
    } catch {
      return false;
    }
  });

  const [showImportModal, setShowImportModal] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastItemsRef = useRef<typeof items | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showSlowLoading, setShowSlowLoading] = useState(false);

  const toggleTasksPane = () => {
    setShowTasksPane(prev => {
      const newValue = !prev;
      localStorage.setItem('bulletpoints-show-tasks', String(newValue));
      return newValue;
    });
  };

  const toggleShortcutsPane = () => {
    setShowShortcutsPane(prev => {
      const newValue = !prev;
      localStorage.setItem('bulletpoints-show-shortcuts', String(newValue));
      return newValue;
    });
  };

  // Clear highlight effect
  useEffect(() => {
    if (highlightedId) {
      const timer = setTimeout(() => setHighlightedId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedId]);

  // Update Document Title
  useEffect(() => {
    if (currentRootId === INITIAL_ROOT_ID) {
      document.title = 'Bulletpoints';
    } else {
      const rootItem = items[currentRootId];
      if (rootItem) {
        const plainText = stripHtml(rootItem.text).trim();
        document.title = plainText || 'Untitled';
      } else {
        document.title = 'Bulletpoints';
      }
    }
  }, [currentRootId, items]);

  // --- Navigation (zoom) backed by browser history so Android back / iOS swipe-back work ---

  const transitionToRoot = useCallback((id: string, direction: NavDirection) => {
    runViewTransition(() => setCurrentRootId(id), direction);
  }, []);

  const navigateTo = (id: string) => {
    const current = currentRootIdRef.current;
    if (id === current) return;
    // Zooming into a descendant slides forward; anything else slides back
    const direction: NavDirection = isAncestor(items, id, current) ? 'forward' : 'back';
    window.history.pushState({ rootId: id }, '', urlForRoot(id));
    transitionToRoot(id, direction);
  };

  useEffect(() => {
    window.history.replaceState({ rootId: currentRootIdRef.current }, '');
    const handlePopState = (e: PopStateEvent) => {
      const id: string = e.state?.rootId ?? getHashRootId() ?? INITIAL_ROOT_ID;
      const current = currentRootIdRef.current;
      if (id === current) return;
      const direction: NavDirection = isAncestor(itemsRef.current, id, current) ? 'forward' : 'back';
      transitionToRoot(id, direction);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [transitionToRoot]);

  // View Navigation Helpers
  const handleNavigateToItem = (parentId: string, itemId: string) => {
    navigateTo(parentId);
    setHighlightedId(itemId);
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
  const { isKeyboardOpen } = useVirtualKeyboard(scrollContainerRef, isNavigatingRef);

  // Native chrome: status bar colours follow the in-app theme
  useEffect(() => {
    syncStatusBar(isDarkMode);
  }, [isDarkMode]);

  // Keep the native splash up until real content can render (with a safety timeout)
  useEffect(() => {
    if (!loading) hideSplash();
  }, [loading]);

  useEffect(() => {
    const safety = setTimeout(hideSplash, 4000);
    const slow = setTimeout(() => setShowSlowLoading(true), 6000);
    if (isNative && Capacitor.getPlatform() === 'ios') {
      // Our own toolbar replaces the iOS form accessory bar
      Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    }
    return () => {
      clearTimeout(safety);
      clearTimeout(slow);
    };
  }, []);

  // Track whether a text field is being edited (drives the mobile toolbar)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      // Focus briefly leaves while moving between items; don't flicker the toolbar
      timer = setTimeout(() => {
        const el = document.activeElement as HTMLElement | null;
        setIsEditing(!!el && el.isContentEditable);
      }, 60);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

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
    const fileName = `bulletpoints_export_${new Date().toISOString().slice(0, 10)}.txt`;

    if (isNative) {
      // Native share sheet (save to Files, Drive, email, ...)
      shareTextFile(fileName, text).catch((error) => console.error('Export failed', error));
      return;
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Focus & Selection State
  const [focusedId, setFocusedIdState] = useState<string | null>(null);
  const [focusOffset, setFocusOffset] = useState<number | null>(null);
  // Bumped to re-apply focus/caret even when id and offset are unchanged (e.g. after a node remounts)
  const [focusNonce, setFocusNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setFocusedId = (id: string | null) => {
    setFocusedIdState(id);
    setFocusOffset(null);
  };

  const focusItem = (id: string, offset: number | null) => {
    setFocusedIdState(id);
    setFocusOffset(offset);
    setFocusNonce(n => n + 1);
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
    if (saveStatus === 'saved' || saveStatus === 'saved-local') {
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
    } else if (saveStatus === 'saved-local') {
       if (!loading) {
         // Show amber to indicate local-only/offline mode
         setRootStatusColor('text-amber-500 dark:text-amber-400');
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
      if (saveStatus !== 'saved' && saveStatus !== 'saved-local') {
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

  const parentMap = useMemo(() => buildParentMap(items), [items]);

  // --- Undo toast ---

  const showUndoToast = (message: string) => {
    toastItemsRef.current = null;
    setToast({ id: Date.now(), message });
  };

  const dismissToast = useCallback(() => setToast(null), []);

  // Any later change makes "Undo" ambiguous, so the toast goes away
  useEffect(() => {
    if (!toast) return;
    if (toastItemsRef.current === null) {
      toastItemsRef.current = items;
    } else if (toastItemsRef.current !== items) {
      setToast(null);
    }
  }, [items, toast]);

  // --- Item operations shared by keyboard, toolbar and gestures ---

  const deleteAndMoveFocus = (id: string, parentId: string) => {
    const currentIndex = visibleItems.indexOf(id);
    if (currentIndex !== -1 && currentIndex < visibleItems.length - 1) {
      setFocusedId(visibleItems[currentIndex + 1]);
    } else if (currentIndex > 0) {
      setFocusedId(visibleItems[currentIndex - 1]);
    } else if (parentId !== currentRootId) {
      setFocusedId(parentId);
    }
    deleteItem(id, parentId);
  };

  // Indent/outdent remount the node under a new parent; keep the caret where it was
  const indentItem = (id: string, parentId: string) => {
    const offset = focusedId === id ? getActiveCaretOffset() : null;
    indent(id, parentId);
    haptic('light');
    if (focusedId === id) focusItem(id, offset);
  };

  const outdentItem = (id: string, parentId: string) => {
    const offset = focusedId === id ? getActiveCaretOffset() : null;
    outdent(id, parentId);
    haptic('light');
    if (focusedId === id) focusItem(id, offset);
  };

  const moveAmongSiblings = (id: string, parentId: string, direction: -1 | 1) => {
    const parent = items[parentId];
    if (!parent) return;
    const index = parent.children.indexOf(id);
    const siblingId = parent.children[index + direction];
    if (index === -1 || !siblingId) return;
    const offset = focusedId === id ? getActiveCaretOffset() : null;
    moveItem(id, siblingId, direction < 0 ? 'before' : 'after');
    haptic('selection');
    if (focusedId === id) focusItem(id, offset);
  };

  const completeTask = (id: string, parentId: string) => {
    deleteItem(id, parentId);
    showUndoToast('Task completed');
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
      const parentId = parentMap[id];
      if (!parentId) return;

      const isAtStart = stripHtml(htmlBefore).length === 0;

      // When pressing Enter at the start of an item with children, we want to insert
      // a new empty item ABOVE the current item, instead of making the current item
      // a child of an empty parent.
      if (isAtStart && item.children.length > 0) {
          const newId = generateId();
          const parent = items[parentId];
          const index = parent.children.indexOf(id);

          let afterId = null;
          if (index > 0) {
              afterId = parent.children[index - 1];
          }

          addItem(parentId, afterId, newId);
          // Ensure current item has full text
          updateText(id, htmlAfter);

          // Keep focus on the current item (which visually moved down)
          focusItem(id, 0);
          setSelectedIds(new Set());
          return;
      }

      updateText(id, htmlBefore);
      const newId = generateId();
      if (item && item.children.length > 0 && !item.collapsed) {
        addItem(id, null, newId);
      } else {
        addItem(parentId, id, newId);
      }
      updateText(newId, htmlAfter);
      focusItem(newId, 0);
      setSelectedIds(new Set());
  };

  // Backspace at the start of an item: merge into the previous one, or delete if empty.
  // Returns true when handled (the caller should prevent the default edit).
  const handleBackspace = (id: string, parentId: string, selectionStart: number | null | undefined): boolean => {
    const isCollapsed = window.getSelection()?.isCollapsed;
    if (selectionStart === 0 && isCollapsed) {
        const currentIndex = visibleItems.indexOf(id);
        if (currentIndex > 0) {
           const prevItemId = visibleItems[currentIndex - 1];
           const prevItem = items[prevItemId];
           if (prevItem) {
               const prevTextLength = stripHtml(prevItem.text).length;
               mergeUp(id, parentId, prevItemId);
               focusItem(prevItemId, prevTextLength);
               setSelectedIds(new Set());
               return true;
           }
        }
    }
    const item = items[id];
    const plainText = stripHtml(item?.text || '');
    if (item && plainText === '' && item.children.length === 0) {
      deleteAndMoveFocus(id, parentId);
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, parentId: string, selectionStart?: number | null) => {
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && selectedIds.size > 0 && e.key.startsWith('Arrow')) {
        setSelectedIds(new Set());
    }

    if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        moveAmongSiblings(id, parentId, -1);
        return;
    }

    if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        moveAmongSiblings(id, parentId, 1);
        return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        deleteAndMoveFocus(id, parentId);
        return;
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        outdentItem(id, parentId);
      } else {
        indentItem(id, parentId);
      }
    } else if (e.key === 'Backspace') {
      if (handleBackspace(id, parentId, selectionStart)) {
        e.preventDefault();
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
    navigateTo(id);
    setFocusedId(null);
    setSelectedIds(new Set());
  };

  // --- Touch drag (long-press a bullet) ---

  const getItems = useCallback(() => itemsRef.current, []);
  const handleTouchDrop = useCallback((dragIds: string[], targetId: string, position: 'before' | 'after' | 'inside') => {
    moveItems(dragIds, targetId, position);
  }, [moveItems]);
  const { draggingIds, dropTarget, startTouchDrag, consumeDragClick } = useTouchDrag(scrollContainerRef, getItems, handleTouchDrop);

  // --- Outline store + stable actions for BulletNode ---

  const storeRef = useRef<OutlineStore | null>(null);
  const view = { items, focusedId, focusOffset, focusNonce, selectedIds, highlightedId, draggingIds };
  if (!storeRef.current) storeRef.current = createOutlineStore(view);
  const store = storeRef.current;
  store.set(view);
  // Let subscribed nodes re-render after every App render (only those whose slice changed will)
  useLayoutEffect(() => {
    store.notify();
  });

  const handlersRef = useRef<BulletActions>(null!);
  handlersRef.current = {
    setFocusedId,
    onKeyDown: handleKeyDown,
    onBackspace: handleBackspace,
    onSplit: handleSplit,
    onUpdateText: updateText,
    onZoom: handleZoom,
    onToggleCollapse: toggleCollapse,
    onMoveItems: moveItems,
    onMultiLinePaste: handleMultiLinePaste,
    onChangeFontSize: changeFontSize,
    onSetIsTask: setIsTask,
    onToggleIsShortcut: toggleIsShortcut,
    onToggleStyle: toggleStyle,
    onCompleteTask: completeTask,
    onIndent: indentItem,
    onOutdent: outdentItem,
    onBulletPointerDown: startTouchDrag,
    consumeDragClick,
  };
  const actions = useMemo(() => {
    const proxy = {} as Record<string, (...args: unknown[]) => unknown>;
    (Object.keys(handlersRef.current) as (keyof BulletActions)[]).forEach((key) => {
      proxy[key] = (...args: unknown[]) => (handlersRef.current[key] as (...a: unknown[]) => unknown)(...args);
    });
    return proxy as unknown as BulletActions;
  }, []);

  // --- Mobile toolbar ---

  const focusedItem = focusedId && focusedId !== currentRootId ? items[focusedId] ?? null : null;
  const focusedParentId = focusedItem ? parentMap[focusedItem.id] : undefined;
  const toolbarState = useMemo(() => {
    if (!focusedItem || !focusedParentId || !items[focusedParentId]) {
      return { canIndent: false, canOutdent: false, canMoveUp: false, canMoveDown: false };
    }
    const siblings = items[focusedParentId].children;
    const index = siblings.indexOf(focusedItem.id);
    return {
      canIndent: index > 0,
      canOutdent: !!parentMap[focusedParentId],
      canMoveUp: index > 0,
      canMoveDown: index !== -1 && index < siblings.length - 1,
    };
  }, [focusedItem, focusedParentId, items, parentMap]);

  const withFocusedItem = (fn: (id: string, parentId: string) => void) => () => {
    if (focusedItem && focusedParentId) fn(focusedItem.id, focusedParentId);
  };

  const cycleFontSize = (id: string) => {
    const size = items[id]?.fontSize || 'small';
    changeFontSize(id, size === 'small' ? 'medium' : size === 'medium' ? 'large' : 'small');
  };

  const handleToolbarDelete = (id: string, parentId: string) => {
    haptic('medium');
    deleteAndMoveFocus(id, parentId);
    showUndoToast('Item deleted');
  };

  const handleDone = () => {
    blurActiveEditor();
    if (isNative) Keyboard.hide().catch(() => {});
  };

  // --- Sheets & back button ---

  const openMobileSheet = (sheet: Sheet) => {
    blurActiveEditor();
    setOpenSheet(sheet);
  };

  // Android back closes overlays first, then zooms out, then leaves the app
  const backHandlerRef = useRef<() => boolean>(() => false);
  backHandlerRef.current = () => {
    if (openSheet) {
      setOpenSheet(null);
      return true;
    }
    if (showImportModal) {
      setShowImportModal(false);
      return true;
    }
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!isNative) return;
    const handle = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (backHandlerRef.current()) return;
      if (canGoBack) {
        window.history.back();
      } else {
        CapacitorApp.minimizeApp().catch(() => CapacitorApp.exitApp());
      }
    });
    return () => {
      handle.then(h => h.remove()).catch(() => {});
    };
  }, []);

  const rootItem = items[currentRootId];

  useEffect(() => {
    if (!loading && !items[currentRootId] && currentRootId !== INITIAL_ROOT_ID) {
      window.history.replaceState({ rootId: INITIAL_ROOT_ID }, '', urlForRoot(INITIAL_ROOT_ID));
      setCurrentRootId(INITIAL_ROOT_ID);
    }
  }, [items, currentRootId, loading]);

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
      <div className={`flex flex-col gap-2 items-center justify-center h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="text-gray-400 text-lg animate-pulse">Loading Bulletpoints...</div>
        {showSlowLoading && <div className="text-gray-400 text-sm">Waiting for a connection</div>}
      </div>
    );
  }

  const tasks = openSheet === 'tasks' ? Object.values(items).filter(i => i.isTask) : [];
  const shortcuts = openSheet === 'shortcuts' ? Object.values(items).filter(i => i.isShortcut) : [];
  const toolbarVisible = isTouch && isEditing && !!focusedItem;
  const canImport = Capacitor.getPlatform() !== 'android';

  return (
    <OutlineStoreContext.Provider value={store}>
    <BulletActionsContext.Provider value={actions}>
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

        {/* Touch drag drop indicator */}
        {dropTarget && (
          <div
            className="fixed h-1 bg-blue-500 rounded-sm pointer-events-none z-50"
            style={{
              top: dropTarget.indicator.top,
              left: dropTarget.indicator.left,
              width: dropTarget.indicator.width
            }}
          />
        )}

        {/* Header */}
        <div className="flex-none w-full z-40 bg-gray-50/95 dark:bg-gray-900/95 border-b border-gray-200/50 dark:border-gray-800/50 pt-[env(safe-area-inset-top)]">
          <div className="max-w-3xl mx-auto w-full px-4 sm:px-8 py-4 relative">
              <Breadcrumbs
                  items={items}
                  parentMap={parentMap}
                  currentRootId={currentRootId}
                  rootId={INITIAL_ROOT_ID}
                  onNavigate={handleZoom}
                  onRefresh={refreshData}
                  rootClassName={rootStatusColor}
                  isDarkMode={isDarkMode}
                  onToggleTheme={toggleTheme}
                  showHelp={showHelp}
                  onToggleHelp={toggleHelp}
                  onExport={handleExport}
                  onImport={canImport ? () => setShowImportModal(true) : undefined}
                  showTasksPane={showTasksPane}
                  onToggleTasksPane={toggleTasksPane}
                  showShortcutsPane={showShortcutsPane}
                  onToggleShortcutsPane={toggleShortcutsPane}
                  onOpenMenu={isTouch ? () => openMobileSheet('menu') : undefined}
              />
          </div>
        </div>

        {/* Tasks Pane */}
        {showTasksPane && (
            <TasksPane
                items={items}
                parentMap={parentMap}
                onNavigate={handleNavigateToItem}
                onCompleteTask={completeTask}
            />
        )}

        {/* Shortcuts Pane */}
        {showShortcutsPane && (
            <ShortcutsPane
                items={items}
                onNavigate={handleZoom}
            />
        )}

        {/* Import Modal */}
        <ImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImport={importFromText}
        />

        {/* Main Content Area */}
        <div
            ref={scrollContainerRef}
            className="zoom-content flex-1 overflow-y-auto overscroll-contain w-full"
            onMouseDown={(e) => {
              // Ensure clicks in the empty area of the list start selection
              if (e.target === e.currentTarget) handleMouseDown(e);
            }}
        >
          <div className={`max-w-3xl mx-auto w-full px-4 sm:px-8 pt-6 ${isTouch ? 'pb-48' : 'pb-32'}`}>
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
                  <div className="text-gray-400 dark:text-gray-500 italic mt-4 cursor-text py-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          const newId = generateId();
                          addItem(currentRootId, null, newId);
                          setFocusedId(newId);
                          setSelectedIds(new Set());
                        }}>
                    {isTouch ? 'Empty list. Tap to add an item.' : 'Empty list. Press Enter to add an item.'}
                  </div>
                )}

                {rootItem.children.map((childId) => (
                  <BulletNode key={childId} id={childId} parentId={currentRootId} />
                ))}
              </div>
            )}
          </div>
        </div>

        {isTouch && (
          <MobileToolbar
              visible={toolbarVisible}
              isKeyboardOpen={isKeyboardOpen}
              item={focusedItem}
              {...toolbarState}
              canUndo={canUndo}
              canRedo={canRedo}
              onIndent={withFocusedItem(indentItem)}
              onOutdent={withFocusedItem(outdentItem)}
              onMoveUp={withFocusedItem((id, parentId) => moveAmongSiblings(id, parentId, -1))}
              onMoveDown={withFocusedItem((id, parentId) => moveAmongSiblings(id, parentId, 1))}
              onToggleTask={withFocusedItem((id) => { setIsTask(id, !items[id]?.isTask); haptic('selection'); })}
              onToggleBold={withFocusedItem((id) => toggleStyle(id, 'bold'))}
              onCycleSize={withFocusedItem(cycleFontSize)}
              onToggleCollapse={withFocusedItem((id) => toggleCollapse(id))}
              onDelete={withFocusedItem(handleToolbarDelete)}
              onUndo={undo}
              onRedo={redo}
              onDone={handleDone}
              onOpenLink={openExternalUrl}
          />
        )}

        <Toast toast={toast} raised={toolbarVisible} onUndo={undo} onDismiss={dismissToast} />

        {/* Mobile menu + lists as bottom sheets */}
        <BottomSheet isOpen={openSheet === 'menu'} onClose={() => setOpenSheet(null)} title="Menu">
          <SheetRow label="Tasks" detail={Object.values(items).filter(i => i.isTask).length || undefined} onPress={() => setOpenSheet('tasks')} />
          <SheetRow label="Shortcuts" detail={Object.values(items).filter(i => i.isShortcut).length || undefined} onPress={() => setOpenSheet('shortcuts')} />
          <SheetRow label={isDarkMode ? 'Light mode' : 'Dark mode'} onPress={() => { toggleTheme(); setOpenSheet(null); }} />
          <SheetRow label={isNative ? 'Share export' : 'Export'} onPress={() => { setOpenSheet(null); handleExport(); }} />
          {canImport && <SheetRow label="Import" onPress={() => { setOpenSheet(null); setShowImportModal(true); }} />}
          <SheetRow label="Sync now" onPress={() => { setOpenSheet(null); refreshData(); }} />
        </BottomSheet>

        <BottomSheet isOpen={openSheet === 'tasks'} onClose={() => setOpenSheet(null)} title="Tasks">
          {tasks.length === 0 && <div className="px-3 py-4 text-gray-400 italic">No tasks found.</div>}
          {tasks.map(task => (
            <SheetRow
              key={task.id}
              label={stripHtml(task.text) || 'Untitled'}
              leading={
                <span
                  role="checkbox"
                  aria-checked="false"
                  aria-label="Complete task"
                  className="shrink-0 w-6 h-6 -m-1 p-1 flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    const parentId = parentMap[task.id];
                    if (parentId) {
                      haptic('success');
                      completeTask(task.id, parentId);
                    }
                  }}
                >
                  <span className="w-4 h-4 border rounded-sm border-gray-400 dark:border-gray-500" />
                </span>
              }
              onPress={() => {
                const parentId = parentMap[task.id];
                setOpenSheet(null);
                if (parentId) handleNavigateToItem(parentId, task.id);
              }}
            />
          ))}
        </BottomSheet>

        <BottomSheet isOpen={openSheet === 'shortcuts'} onClose={() => setOpenSheet(null)} title="Shortcuts">
          {shortcuts.length === 0 && <div className="px-3 py-4 text-gray-400 italic">No shortcuts found. Type /s in an item to add one.</div>}
          {shortcuts.map(item => (
            <SheetRow
              key={item.id}
              label={stripHtml(item.text) || 'Untitled'}
              onPress={() => {
                setOpenSheet(null);
                handleZoom(item.id);
              }}
            />
          ))}
        </BottomSheet>

        {/* Help Footer */}
        {showHelp && !isTouch && (
        <div className="fixed bottom-4 right-8 text-xs text-gray-400 dark:text-gray-500 pointer-events-none text-right hidden md:block">
          <p>Click & Drag background to select items</p>
          <p>Cmd/Ctrl+Click bullet to collapse/expand</p>
          <p>Drag bullet point to move items</p>
          <p>Tab to indent, Shift+Tab to outdent</p>
          <p>Cmd+Up/Down to move items</p>
          <p>/t to toggle task</p>
          <p>/s to toggle shortcut</p>
          <p>/b, /i, /u to style</p>
          <p>/1, /2, /3 to resize</p>
        </div>
        )}
      </div>
    </div>
    </BulletActionsContext.Provider>
    </OutlineStoreContext.Provider>
  );
};

export default App;
