
import React, { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react';
import { Item, ItemMap, DropPosition } from '../types';
import { linkifyHtml } from '../utils';

interface BulletNodeProps {
  id: string;
  items: ItemMap;
  parentId: string;
  focusedId: string | null;
  focusOffset?: number | null;
  selectedIds: Set<string>;
  setFocusedId: (id: string | null) => void;
  onKeyDown: (e: React.KeyboardEvent, id: string, parentId: string, selectionStart?: number | null, text?: string) => void;
  onSplit: (id: string, htmlBefore: string, htmlAfter: string) => void;
  onUpdateText: (id: string, text: string) => void;
  onZoom: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onMoveItems: (dragIds: string[], targetId: string, position: DropPosition) => void;
  onSelect: (id: string, shiftKey: boolean, metaKey: boolean, altKey: boolean) => void;
  onMultiLinePaste: (id: string, parentId: string, text: string, prefix: string, suffix: string) => void;
  onChangeFontSize: (id: string, size: 'small' | 'medium' | 'large') => void;
}

// Helper to set cursor at specific character offset within a contentEditable element
const setCaretPosition = (root: HTMLElement, offset: number) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  let currentOffset = 0;
  let found = false;

  const selection = window.getSelection();
  const range = document.createRange();

  while (node) {
    const length = node.nodeValue?.length || 0;
    if (currentOffset + length >= offset) {
      range.setStart(node, offset - currentOffset);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      found = true;
      break;
    }
    currentOffset += length;
    node = walker.nextNode();
  }

  // If offset is greater than content length, move to end
  if (!found) {
    range.selectNodeContents(root);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
};

export const BulletNode: React.FC<BulletNodeProps> = ({
  id,
  items,
  parentId,
  focusedId,
  focusOffset,
  selectedIds,
  setFocusedId,
  onKeyDown,
  onSplit,
  onUpdateText,
  onZoom,
  onToggleCollapse,
  onMoveItems,
  onSelect,
  onMultiLinePaste,
  onChangeFontSize,
}) => {
  const item = items[id];
  const nodeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreCaretRef = useRef<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);

  const isSelected = selectedIds.has(id);
  const isFocused = focusedId === id;

  // Focus management
  useEffect(() => {
    if (isFocused && nodeRef.current) {
      nodeRef.current.focus();
      if (typeof focusOffset === 'number') {
        setCaretPosition(nodeRef.current, focusOffset);
      }
    }
  }, [isFocused, focusOffset]);

  // Sync content if changed externally and restore caret if needed
  useLayoutEffect(() => {
    if (nodeRef.current && nodeRef.current.innerHTML !== item.text) {
      nodeRef.current.innerHTML = item.text;
      
      // If we are focused and have a pending caret restoration (from auto-linking), restore it
      if (isFocused && restoreCaretRef.current !== null) {
        setCaretPosition(nodeRef.current, restoreCaretRef.current);
        restoreCaretRef.current = null;
      }
    }
  }, [item.text, isFocused]);

  if (!item) return null;

  const hasChildren = item.children.length > 0;

  const handleBulletClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
        onToggleCollapse(id);
        return;
    }
    onZoom(id);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n')) {
        e.preventDefault();
        
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        
        // This is a simplified "split at cursor" logic for paste, 
        // similar to existing textarea logic but using textContent approximation for now
        // or passing the full text to the handler.
        
        // For robustness with HTML content, we try to preserve the HTML of the current node
        // but simple multiline paste usually implies plain text insertion for new items.
        
        // 1. Get HTML before cursor
        const range = selection.getRangeAt(0);
        const rangeBefore = document.createRange();
        rangeBefore.setStart(nodeRef.current!, 0);
        rangeBefore.setEnd(range.startContainer, range.startOffset);
        
        // This is tricky with HTML. Let's fallback to the handler which likely does text splitting.
        // Or better, let's just use the text content for the split to keep it reliable for the clone.
        const prefix = nodeRef.current?.innerText.substring(0, getCaretCharacterOffsetWithin(nodeRef.current!)) || '';
        const suffix = nodeRef.current?.innerText.substring(getCaretCharacterOffsetWithin(nodeRef.current!)) || '';
        
        onMultiLinePaste(id, parentId, text, prefix, suffix);
    }
    // Else let default paste happen (preserves rich text if copied from HTML, or inserts text)
  };

  // Helper to get caret text offset
  function getCaretCharacterOffsetWithin(element: HTMLElement) {
    let caretOffset = 0;
    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;
    const sel = win?.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      caretOffset = preCaretRange.toString().length;
    }
    return caretOffset;
  }

  const applyFormat = (command: string) => {
    if (!nodeRef.current) return;
    
    // Check if we need to select all (if collapsed)
    const sel = window.getSelection();
    let madeSelection = false;
    
    if (sel && sel.isCollapsed && nodeRef.current.contains(sel.anchorNode)) {
        document.execCommand('selectAll', false, undefined);
        madeSelection = true;
    }

    document.execCommand(command, false, undefined);
    
    // Trigger update immediately
    onUpdateText(id, nodeRef.current.innerHTML);
    
    // If we selected all, maybe collapse to end to allow typing?
    // Prompt says: "the whole text ... will have the style applied".
    // Usually leaving it selected is fine, or user clicks away.
  };

  const handleKeyDownWrapper = (e: React.KeyboardEvent) => {
    // Rich Text Shortcuts
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (e.key === 'b') {
            e.preventDefault();
            applyFormat('bold');
            return;
        }
        if (e.key === 'i') {
            e.preventDefault();
            applyFormat('italic');
            return;
        }
        if (e.key === 'u') {
            e.preventDefault();
            applyFormat('underline');
            return;
        }
        // Font Size Shortcuts
        if (e.key === '1') {
            e.preventDefault();
            onChangeFontSize(id, 'large');
            return;
        }
        if (e.key === '2') {
            e.preventDefault();
            onChangeFontSize(id, 'medium');
            return;
        }
        if (e.key === '3') {
            e.preventDefault();
            onChangeFontSize(id, 'small');
            return;
        }
    }

    // Split on Enter (but not Cmd+Enter which deletes)
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        
        if (!nodeRef.current) return;

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        
        const range = sel.getRangeAt(0);
        
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

        onSplit(id, htmlBefore, htmlAfter);
        return;
    }
    
    // For navigation/deletion, we need text offset
    const selectionStart = nodeRef.current ? getCaretCharacterOffsetWithin(nodeRef.current) : 0;
    
    onKeyDown(e, id, parentId, selectionStart, nodeRef.current?.innerHTML);
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const rawHtml = e.currentTarget.innerHTML;
    // Auto-linkify logic
    const linkedHtml = linkifyHtml(rawHtml);
    
    if (linkedHtml !== rawHtml) {
      // If we changed the HTML (added a link), we need to save the caret position
      // because React will update the DOM via innerHTML, resetting the cursor.
      restoreCaretRef.current = getCaretCharacterOffsetWithin(nodeRef.current!);
      onUpdateText(id, linkedHtml);
    } else {
      onUpdateText(id, rawHtml);
    }
  };

  const handleContentClick = (e: React.MouseEvent) => {
    // Allow opening links with Cmd/Ctrl + Click
    const target = e.target as HTMLElement;
    if (target.tagName === 'A') {
      if (e.metaKey || e.ctrlKey) {
        window.open((target as HTMLAnchorElement).href, '_blank');
      }
    }
  };

  // --- Drag & Drop Handlers ---

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    let itemsToDrag = [id];
    if (isSelected) {
      itemsToDrag = Array.from(selectedIds);
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
    if (!containerRef.current) return;
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
    const dragIdsJson = e.dataTransfer.getData('application/bulletpoints-ids');
    if (dragIdsJson && dragOverPosition) {
      try {
        const dragIds = JSON.parse(dragIdsJson);
        if (dragIds.length > 0) onMoveItems(dragIds, id, dragOverPosition);
      } catch (e) {
        console.error("Failed to parse drag data", e);
      }
    }
    setDragOverPosition(null);
  };

  const sizeConfig = {
    'small': { 
      text: 'text-base leading-6', 
      bulletMargin: 'mt-0',
      wrapperPadding: 'pt-1' 
    },
    'medium': { 
      text: 'text-2xl leading-8 font-medium', 
      bulletMargin: 'mt-1', 
      wrapperPadding: 'pt-4' 
    },
    'large': { 
      text: 'text-3xl leading-9 font-bold', 
      bulletMargin: 'mt-1.5', 
      wrapperPadding: 'pt-8' 
    },
  }[item.fontSize || 'small'];

  return (
    <div className="relative">
      <div 
        ref={containerRef}
        data-node-id={id}
        className={`bullet-node-wrapper flex items-start pb-1 ${sizeConfig.wrapperPadding} pr-4 group transition-colors duration-100 relative rounded-sm ${isSelected ? 'bg-blue-100 dark:bg-blue-900 dark:bg-opacity-40' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOverPosition === 'before' && <div className="drop-indicator absolute -top-0.5 left-0 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}
        {dragOverPosition === 'after' && <div className="drop-indicator absolute -bottom-0.5 left-0 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}
        {dragOverPosition === 'inside' && <div className="drop-indicator absolute -bottom-0.5 left-8 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}

        <div 
          className={`relative flex-shrink-0 w-6 h-6 flex items-center justify-center -ml-2 mr-1 cursor-move group/bullet ${sizeConfig.bulletMargin}`}
          draggable
          onDragStart={handleDragStart}
        >
          <div 
            className="absolute inset-0 rounded-full cursor-pointer z-20 transform scale-150"
            onClick={handleBulletClick}
          ></div>
          <div className="absolute inset-0 rounded-full bg-gray-200 dark:bg-gray-700 opacity-0 group-hover/bullet:opacity-100 transition-opacity duration-200 transform scale-75 pointer-events-none"></div>
          <div className={`z-10 rounded-full transition-all duration-200 pointer-events-none ${item.collapsed && hasChildren ? 'w-2 h-2 bg-gray-500 dark:bg-gray-400 ring-2 ring-gray-300 dark:ring-gray-600' : 'w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500 group-hover/bullet:bg-gray-600 dark:group-hover/bullet:bg-gray-300'}`}></div>
        </div>

        <div
          ref={nodeRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onClick={handleContentClick}
          onKeyDown={handleKeyDownWrapper}
          onPaste={handlePaste}
          onFocus={() => setFocusedId(id)}
          className={`flex-grow min-w-0 outline-none text-gray-800 dark:text-gray-100 font-medium py-[2px] break-words ${sizeConfig.text}`}
          style={{ minHeight: '24px' }}
        />
      </div>

      {hasChildren && !item.collapsed && (
        <div className="ml-5 border-l border-gray-200 dark:border-gray-800 pl-2">
          {item.children.map((childId) => (
            <BulletNode
              key={childId}
              id={childId}
              items={items}
              parentId={id}
              focusedId={focusedId}
              focusOffset={focusOffset}
              selectedIds={selectedIds}
              setFocusedId={setFocusedId}
              onKeyDown={onKeyDown}
              onSplit={onSplit}
              onUpdateText={onUpdateText}
              onZoom={onZoom}
              onToggleCollapse={onToggleCollapse}
              onMoveItems={onMoveItems}
              onSelect={onSelect}
              onMultiLinePaste={onMultiLinePaste}
              onChangeFontSize={onChangeFontSize}
            />
          ))}
        </div>
      )}
    </div>
  );
};
