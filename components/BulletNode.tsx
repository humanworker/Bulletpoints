
import React, { useRef, useEffect, useState, useLayoutEffect, memo } from 'react';
import { DropPosition } from '../types';
import { linkifyHtml, setCaretPosition, getCaretCharacterOffsetWithin } from '../utils';
import { useOutline, useOutlineStore, useBulletActions } from '../hooks/useOutlineStore';
import { isTouchDevice, haptic, openExternalUrl } from '../native';

interface BulletNodeProps {
  id: string;
  parentId: string;
}

const isTouch = isTouchDevice();

// Horizontal distance a row must be swiped to indent (right) or outdent (left)
const SWIPE_THRESHOLD = 64;
const SWIPE_MAX = 96;

const BulletNodeInner: React.FC<BulletNodeProps> = ({ id, parentId }) => {
  const store = useOutlineStore();
  const actions = useBulletActions();

  const item = useOutline((v) => v.items[id]);
  const isFocused = useOutline((v) => v.focusedId === id);
  const focusOffset = useOutline((v) => (v.focusedId === id ? v.focusOffset : null));
  const focusNonce = useOutline((v) => (v.focusedId === id ? v.focusNonce : 0));
  const isSelected = useOutline((v) => v.selectedIds.has(id));
  const isHighlighted = useOutline((v) => v.highlightedId === id);
  const isDragging = useOutline((v) => !!v.draggingIds?.has(id));

  const nodeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreCaretRef = useRef<number | null>(null);
  const commandTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isComposingRef = useRef(false);
  const swipeRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; armed: boolean } | null>(null);
  const linkTapRef = useRef(false);
  const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  // Cleanup command timeout
  useEffect(() => {
    return () => {
      if (commandTimeoutRef.current) {
        clearTimeout(commandTimeoutRef.current);
      }
    };
  }, []);

  // Scroll into view if highlighted
  useEffect(() => {
    if (isHighlighted && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isHighlighted]);

  // Focus management
  useEffect(() => {
    if (isFocused && nodeRef.current) {
      if (document.activeElement !== nodeRef.current) {
        nodeRef.current.focus({ preventScroll: true });
      }
      if (typeof focusOffset === 'number') {
        setCaretPosition(nodeRef.current, focusOffset);
      }
    }
  }, [isFocused, focusOffset, focusNonce]);

  // Sync content if changed externally and restore caret if needed
  useLayoutEffect(() => {
    if (item && nodeRef.current && nodeRef.current.innerHTML !== item.text) {
      nodeRef.current.innerHTML = item.text;

      // If we are focused and have a pending caret restoration (from auto-linking), restore it
      if (isFocused && restoreCaretRef.current !== null) {
        setCaretPosition(nodeRef.current, restoreCaretRef.current);
        restoreCaretRef.current = null;
      }
    }
  }, [item?.text, isFocused]);

  // Mobile keyboards often send Enter/Backspace without a usable keydown (keyCode 229),
  // so also handle the equivalent beforeinput events.
  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    const handleBeforeInput = (e: InputEvent) => {
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        e.preventDefault();
        splitAtCaret();
      } else if (e.inputType === 'deleteContentBackward') {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed) return;
        const offset = getCaretCharacterOffsetWithin(el);
        if (offset === 0 && actions.onBackspace(id, parentId, 0)) {
          e.preventDefault();
        }
      }
    };
    el.addEventListener('beforeinput', handleBeforeInput);
    return () => el.removeEventListener('beforeinput', handleBeforeInput);
  });

  if (!item) return null;

  const hasChildren = item.children.length > 0;

  const handleBulletClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (actions.consumeDragClick()) return;
    if (e.metaKey || e.ctrlKey) {
        actions.onToggleCollapse(id);
        return;
    }
    actions.onZoom(id);
  };

  const handleTaskClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCompleting) return;
    // Let the check + strikethrough register before the item disappears
    setIsCompleting(true);
    haptic('success');
    setTimeout(() => actions.onCompleteTask(id, parentId), 280);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n')) {
        e.preventDefault();

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const prefix = nodeRef.current?.innerText.substring(0, getCaretCharacterOffsetWithin(nodeRef.current!)) || '';
        const suffix = nodeRef.current?.innerText.substring(getCaretCharacterOffsetWithin(nodeRef.current!)) || '';

        actions.onMultiLinePaste(id, parentId, text, prefix, suffix);
    }
  };

  const splitAtCaret = () => {
    if (!nodeRef.current) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // Check if we are at the very beginning of the text content
    // This avoids destructive extraction if we are just inserting above
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(nodeRef.current);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const textBefore = preCaretRange.toString();

    if (textBefore.length === 0) {
        actions.onSplit(id, '', nodeRef.current.innerHTML);
        return;
    }

    // Create the "After" part
    const rangeAfter = range.cloneRange();
    rangeAfter.setEndAfter(nodeRef.current.lastChild || nodeRef.current);

    // Extract contents (removes from DOM) - this effectively splits the DOM node
    const fragmentAfter = rangeAfter.extractContents();

    // The remaining content in nodeRef is the "Before" part
    const htmlBefore = nodeRef.current.innerHTML;

    // Convert fragment to HTML string
    const div = document.createElement('div');
    div.appendChild(fragmentAfter);
    const htmlAfter = div.innerHTML;

    actions.onSplit(id, htmlBefore, htmlAfter);
  };

  const handleKeyDownWrapper = (e: React.KeyboardEvent) => {
    // Split on Enter (but not Cmd+Enter which deletes)
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        splitAtCaret();
        return;
    }

    // For navigation/deletion, we need text offset
    const selectionStart = nodeRef.current ? getCaretCharacterOffsetWithin(nodeRef.current) : 0;

    actions.onKeyDown(e, id, parentId, selectionStart);
  };

  const processInput = (rawHtml: string) => {
    // Clear any pending command check (debounce)
    if (commandTimeoutRef.current) {
        clearTimeout(commandTimeoutRef.current);
        commandTimeoutRef.current = null;
    }

    // Rewriting the DOM mid-composition breaks autocorrect / swipe typing, so wait for it to end
    if (isComposingRef.current) {
      actions.onUpdateText(id, rawHtml);
      return;
    }

    // Auto-linkify logic - Update text immediately
    const linkedHtml = linkifyHtml(rawHtml);

    if (linkedHtml !== rawHtml) {
      restoreCaretRef.current = getCaretCharacterOffsetWithin(nodeRef.current!);
      actions.onUpdateText(id, linkedHtml);
    } else {
      actions.onUpdateText(id, rawHtml);
    }

    // Schedule delayed command check (1 second)
    commandTimeoutRef.current = setTimeout(() => {
        if (!nodeRef.current || isComposingRef.current) return;
        const currentHtml = nodeRef.current.innerHTML;
        const currentItem = store.get().items[id];
        if (!currentItem) return;

        const commands: {cmd: string, action: () => void}[] = [
            { cmd: '/t', action: () => actions.onSetIsTask(id, !currentItem.isTask) },
            { cmd: '/b', action: () => actions.onToggleStyle(id, 'bold') },
            { cmd: '/i', action: () => actions.onToggleStyle(id, 'italic') },
            { cmd: '/u', action: () => actions.onToggleStyle(id, 'underline') },
            { cmd: '/1', action: () => actions.onChangeFontSize(id, 'large') },
            { cmd: '/2', action: () => actions.onChangeFontSize(id, 'medium') },
            { cmd: '/3', action: () => actions.onChangeFontSize(id, 'small') },
            { cmd: '/s', action: () => actions.onToggleIsShortcut(id) },
        ];

        for (const {cmd, action} of commands) {
             let matchLength = 0;
             if (currentHtml.endsWith(cmd)) {
                matchLength = cmd.length;
             } else if (currentHtml.endsWith(cmd + '&nbsp;')) {
                matchLength = cmd.length + 6;
             } else if (currentHtml.endsWith(cmd + ' ')) {
                matchLength = cmd.length + 1;
             }

             if (matchLength > 0) {
                 const cleanHtml = currentHtml.substring(0, currentHtml.length - matchLength);

                 // Valid predecessors: Start of string, Space, Non-breaking space
                 // This prevents commands from triggering inside words or URLs (e.g. house/igloo, http://site.com/1)
                 const isValidTrigger = cleanHtml.length === 0 ||
                                        cleanHtml.endsWith(' ') ||
                                        cleanHtml.endsWith('&nbsp;');

                 if (isValidTrigger) {
                     restoreCaretRef.current = Math.max(0, getCaretCharacterOffsetWithin(nodeRef.current!) - cmd.length);
                     actions.onUpdateText(id, cleanHtml);
                     action();
                     return;
                 }
            }
        }
    }, 1000);
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    processInput(e.currentTarget.innerHTML);
  };

  const handleCompositionEnd = () => {
    isComposingRef.current = false;
    if (nodeRef.current) processInput(nodeRef.current.innerHTML);
  };

  const handleContentPointerDown = (e: React.PointerEvent) => {
    // On touch, tapping a link in a row you're not editing opens it instead of placing the caret
    const link = (e.target as HTMLElement).closest('a');
    linkTapRef.current = false;
    if (isTouch && link && document.activeElement !== nodeRef.current) {
      e.preventDefault();
      linkTapRef.current = true;
    }
  };

  const handleContentClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    if (linkTapRef.current) {
      e.preventDefault();
      linkTapRef.current = false;
      openExternalUrl((target as HTMLAnchorElement).href);
      return;
    }
    // Allow opening links with Cmd/Ctrl + Click
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      openExternalUrl((target as HTMLAnchorElement).href);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // If double clicking the container/empty space, select all text
    // If clicking text, let native behavior handle word selection
    if (e.target === nodeRef.current && nodeRef.current) {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(nodeRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }
  };

  // --- Swipe to indent / outdent (touch) ---

  const resetSwipe = (animate: boolean) => {
    const el = containerRef.current;
    if (el) {
      el.style.transition = animate ? 'transform 180ms cubic-bezier(0.2, 0, 0, 1)' : '';
      el.style.transform = '';
    }
    swipeRef.current = null;
  };

  const handleRowPointerDown = (e: React.PointerEvent) => {
    if (!isTouch || e.pointerType !== 'touch') return;
    if ((e.target as HTMLElement).closest('.bullet-handle, input')) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false, armed: false };
  };

  const handleRowPointerMove = (e: React.PointerEvent) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;

    if (!swipe.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        swipeRef.current = null; // Vertical scroll, not a swipe
        return;
      }
      const selection = window.getSelection();
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5 || (selection && !selection.isCollapsed)) return;
      swipe.active = true;
      if (containerRef.current) containerRef.current.style.transition = '';
    }

    const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
    if (containerRef.current) containerRef.current.style.transform = `translateX(${clamped}px)`;
    const armed = Math.abs(dx) >= SWIPE_THRESHOLD;
    if (armed !== swipe.armed) {
      swipe.armed = armed;
      if (armed) haptic('selection');
    }
  };

  const handleRowPointerUp = (e: React.PointerEvent) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    const wasActive = swipe.active;
    resetSwipe(true);
    if (!wasActive) return;
    if (dx >= SWIPE_THRESHOLD) {
      actions.onIndent(id, parentId);
    } else if (dx <= -SWIPE_THRESHOLD) {
      actions.onOutdent(id, parentId);
    }
  };

  // --- Drag & Drop Handlers (mouse; touch uses long-press on the bullet) ---

  const handleDragStart = (e: React.DragEvent) => {
    if (isTouch) return; // Guard

    e.stopPropagation();
    let itemsToDrag = [id];
    if (isSelected) {
      itemsToDrag = Array.from(store.get().selectedIds);
    }
    e.dataTransfer.setData('application/bulletpoints-ids', JSON.stringify(itemsToDrag));
    e.dataTransfer.effectAllowed = 'move';

    // Drag Ghost
    if (itemsToDrag.length > 1) {
        const ghost = document.createElement('div');
        ghost.textContent = `${itemsToDrag.length} items`;
        ghost.className = 'bg-gray-800 text-white px-3 py-1 rounded-full text-sm font-bold shadow-lg';
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => document.body.removeChild(ghost), 0);
    } else {
        if (containerRef.current) {
            const ghost = containerRef.current.cloneNode(true) as HTMLElement;
            ghost.style.position = 'absolute';
            ghost.style.top = '-1000px';
            ghost.style.width = `${Math.min(containerRef.current.offsetWidth, 600)}px`;
            ghost.classList.remove('bg-blue-100');
            ghost.classList.remove('dark:bg-blue-900');
            ghost.classList.remove('dark:bg-opacity-40');
            const indicators = ghost.querySelectorAll('.drop-indicator');
            indicators.forEach(el => el.remove());
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 20, 15);
            setTimeout(() => document.body.removeChild(ghost), 0);
        }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current || isTouch) return;
    const rect = containerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    if (y < height * 0.25) setDragOverPosition('before');
    else if (y > height * 0.75) setDragOverPosition('after');
    else setDragOverPosition('inside');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setDragOverPosition(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTouch) return;

    const dragIdsJson = e.dataTransfer.getData('application/bulletpoints-ids');
    if (dragIdsJson && dragOverPosition) {
      try {
        const dragIds = JSON.parse(dragIdsJson);
        if (dragIds.length > 0) actions.onMoveItems(dragIds, id, dragOverPosition);
      } catch (e) {
        console.error("Failed to parse drag data", e);
      }
    }
    setDragOverPosition(null);
  };

  const sizeConfig = {
    'small': {
      text: 'text-base leading-6',
      bulletMargin: 'mt-0.5',
      wrapperPadding: 'pt-1'
    },
    'medium': {
      text: 'text-2xl leading-8',
      bulletMargin: 'mt-1.5',
      wrapperPadding: 'pt-4'
    },
    'large': {
      text: 'text-3xl leading-9',
      bulletMargin: 'mt-2',
      wrapperPadding: 'pt-8'
    },
  }[item.fontSize || 'small'];

  // Style computation
  let wrapperClasses = `bullet-node-wrapper flex items-start pb-1 ${sizeConfig.wrapperPadding} pr-4 group transition-colors duration-100 relative rounded-sm `;

  if (isSelected) {
      wrapperClasses += 'bg-blue-100 dark:bg-blue-900 dark:bg-opacity-40 ';
  }
  if (isDragging) {
      wrapperClasses += 'opacity-40 ';
  }

  const textColorClass = isHighlighted
      ? 'text-black dark:text-black'
      : item.isShortcut
        ? 'text-yellow-700 dark:text-yellow-500'
        : 'text-gray-800 dark:text-gray-100';

  let contentClasses = `outline-none py-[2px] break-words select-text ${textColorClass} ${sizeConfig.text} `;
  contentClasses += item.isBold ? 'font-bold ' : 'font-medium ';
  if (item.isItalic) contentClasses += 'italic ';
  if (item.isUnderlined) contentClasses += 'underline ';
  if (item.collapsed && hasChildren) contentClasses += 'underline decoration-gray-300 dark:decoration-gray-600 ';
  if (isHighlighted) contentClasses += 'bg-yellow-300 dark:bg-yellow-300 rounded-sm px-1 -ml-1 ';
  if (isCompleting) contentClasses += 'line-through opacity-40 transition-opacity duration-200 ';

  // Make contentEditable full width so clicks in empty space hit it
  contentClasses += 'w-full block ';

  return (
    <div className="relative">
      <div
        ref={containerRef}
        data-node-id={id}
        className={wrapperClasses}
        style={isTouch ? { touchAction: 'pan-y' } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPointerDown={handleRowPointerDown}
        onPointerMove={handleRowPointerMove}
        onPointerUp={handleRowPointerUp}
        onPointerCancel={() => resetSwipe(true)}
      >
        {dragOverPosition === 'before' && <div className="drop-indicator absolute -top-0.5 left-0 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}
        {dragOverPosition === 'after' && <div className="drop-indicator absolute -bottom-0.5 left-0 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}
        {dragOverPosition === 'inside' && <div className="drop-indicator absolute -bottom-0.5 left-8 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}

        <div
          className={`bullet-handle relative flex-shrink-0 w-6 h-6 flex items-center justify-center -ml-2 mr-1 ${!isTouch ? 'cursor-move' : ''} group/bullet ${sizeConfig.bulletMargin}`}
          style={isTouch && !item.isTask ? { touchAction: 'none' } : undefined}
          draggable={!isTouch}
          onDragStart={handleDragStart}
          onPointerDown={(e) => {
            if (!item.isTask) actions.onBulletPointerDown(e, id);
          }}
          onContextMenu={(e) => {
            if (isTouch) e.preventDefault();
          }}
        >
          {item.isTask ? (
            <input
              type="checkbox"
              checked={isCompleting}
              readOnly
              className={`appearance-none w-4 h-4 border rounded-sm bg-transparent checked:bg-blue-500 checked:border-blue-500 cursor-pointer transition-colors relative z-20 translate-y-[1px] border-gray-400 dark:border-gray-500 ${isTouch ? 'scale-125' : ''}`}
              onClick={handleTaskClick}
            />
          ) : (
            <>
              <div
                className={`absolute inset-0 rounded-full cursor-pointer z-20 transform ${isTouch ? 'scale-[1.75]' : 'scale-150'}`}
                onClick={handleBulletClick}
              ></div>
              <div className="absolute inset-0 rounded-full bg-gray-200 dark:bg-gray-700 opacity-0 group-hover/bullet:opacity-100 transition-opacity duration-200 transform scale-75 pointer-events-none"></div>

              {item.collapsed && hasChildren ? (
                <div className={`z-10 w-1.5 h-1.5 pointer-events-none transition-all duration-200 group-hover/bullet:bg-gray-700 dark:group-hover/bullet:bg-gray-200 ${isHighlighted ? 'bg-black' : 'bg-gray-500 dark:bg-gray-400'}`}></div>
              ) : (
                <div className={`z-10 rounded-full transition-all duration-200 pointer-events-none w-1.5 h-1.5 group-hover/bullet:bg-gray-600 dark:group-hover/bullet:bg-gray-300 ${isHighlighted ? 'bg-black' : 'bg-gray-400 dark:bg-gray-500'}`}></div>
              )}
            </>
          )}
        </div>

        <div
          className="flex-grow min-w-0 cursor-text"
          onClick={(e) => {
            // Focus the editor if clicking on the empty space of the row
            // Note: With w-full contentEditable, this mostly handles clicks in the wrapper padding
            if (e.target !== nodeRef.current && !(e.target as HTMLElement).closest('a')) {
              e.preventDefault();
              if (nodeRef.current) {
                nodeRef.current.focus();
                // Place cursor at the end
                const range = document.createRange();
                range.selectNodeContents(nodeRef.current);
                range.collapse(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }
          }}
        >
          <div
            ref={nodeRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={handleCompositionEnd}
            onPointerDown={handleContentPointerDown}
            onClick={handleContentClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDownWrapper}
            onPaste={handlePaste}
            onFocus={() => { if (!isFocused) actions.setFocusedId(id); }}
            className={contentClasses}
            style={{ minHeight: '24px' }}
          />
        </div>
      </div>

      {hasChildren && !item.collapsed && (
        <div className={`ml-5 border-l pl-2 ${isHighlighted ? 'border-gray-800' : 'border-gray-200 dark:border-gray-800'}`}>
          {item.children.map((childId) => (
            <BulletNode key={childId} id={childId} parentId={id} />
          ))}
        </div>
      )}
    </div>
  );
};

export const BulletNode = memo(BulletNodeInner);
