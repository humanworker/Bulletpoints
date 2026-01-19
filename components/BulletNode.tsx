
import React, { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react';
import { Item, ItemMap, DropPosition } from '../types';

interface BulletNodeProps {
  id: string;
  items: ItemMap;
  parentId: string;
  focusedId: string | null;
  focusOffset?: number | null;
  selectedIds: Set<string>;
  setFocusedId: (id: string | null) => void;
  onKeyDown: (e: React.KeyboardEvent, id: string, parentId: string, selectionStart?: number | null, text?: string) => void;
  onUpdateText: (id: string, text: string) => void;
  onZoom: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onMoveItems: (dragIds: string[], targetId: string, position: DropPosition) => void;
  onSelect: (id: string, shiftKey: boolean, metaKey: boolean, altKey: boolean) => void;
  onMultiLinePaste: (id: string, parentId: string, text: string, prefix: string, suffix: string) => void;
}

export const BulletNode: React.FC<BulletNodeProps> = ({
  id,
  items,
  parentId,
  focusedId,
  focusOffset,
  selectedIds,
  setFocusedId,
  onKeyDown,
  onUpdateText,
  onZoom,
  onToggleCollapse,
  onMoveItems,
  onSelect,
  onMultiLinePaste,
}) => {
  const item = items[id];
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);

  const isSelected = selectedIds.has(id);

  const adjustHeight = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, []);

  // Focus management
  useEffect(() => {
    if (focusedId === id && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
      if (typeof focusOffset === 'number') {
        inputRef.current.setSelectionRange(focusOffset, focusOffset);
      }
      adjustHeight();
    }
  }, [focusedId, id, adjustHeight, focusOffset]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [item.text, adjustHeight]);

  // Adjust height when width changes
  useEffect(() => {
    if (!inputRef.current) return;
    
    let prevWidth = 0;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width !== prevWidth) {
          prevWidth = width;
          adjustHeight();
        }
      }
    });

    observer.observe(inputRef.current);
    return () => observer.disconnect();
  }, [adjustHeight]);

  if (!item) return null;

  const hasChildren = item.children.length > 0;

  const handleBulletClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Cmd/Ctrl + Click = Toggle Collapse
    if (e.metaKey || e.ctrlKey) {
        onToggleCollapse(id);
        return;
    }
    
    // Default action: Zoom
    onZoom(id);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n')) {
        e.preventDefault();
        
        const input = inputRef.current;
        if (!input) return;
        
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        const currentText = input.value;
        
        const prefix = currentText.substring(0, selectionStart);
        const suffix = currentText.substring(selectionEnd);
        
        onMultiLinePaste(id, parentId, text, prefix, suffix);
    }
  };

  const handleKeyDownWrapper = (e: React.KeyboardEvent) => {
    if (inputRef.current) {
      if (e.key === 'Enter' && e.shiftKey) {
        e.stopPropagation();
        return;
      }
      if (e.key === 'ArrowUp') {
        if (inputRef.current.selectionStart > 0) {
          e.stopPropagation();
          return;
        }
      }
      if (e.key === 'ArrowDown') {
        if (inputRef.current.selectionStart < inputRef.current.value.length) {
          e.stopPropagation();
          return;
        }
      }
    }
    const selectionStart = inputRef.current?.selectionStart ?? null;
    const value = inputRef.current?.value;
    onKeyDown(e, id, parentId, selectionStart, value);
  };

  // --- Drag & Drop Handlers ---

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    let itemsToDrag = [id];
    if (isSelected) {
      itemsToDrag = Array.from(selectedIds);
    }
    e.dataTransfer.setData('application/minflow-ids', JSON.stringify(itemsToDrag));
    e.dataTransfer.effectAllowed = 'move';

    // Drag Ghost Setup
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
        if (nodeRef.current) {
            const ghost = nodeRef.current.cloneNode(true) as HTMLElement;
            ghost.style.position = 'absolute';
            ghost.style.top = '-1000px';
            ghost.style.left = '-1000px';
            ghost.style.width = `${Math.min(nodeRef.current.offsetWidth, 600)}px`;
            ghost.style.backgroundColor = 'transparent'; 
            ghost.style.pointerEvents = 'none';
            if (!isSelected) ghost.classList.remove('bg-blue-100'); // Check match with render class
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
    if (!nodeRef.current) return;
    const rect = nodeRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    if (y < height * 0.25) setDragOverPosition('before');
    else if (y > height * 0.75) setDragOverPosition('after');
    else setDragOverPosition('inside');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (nodeRef.current && !nodeRef.current.contains(e.relatedTarget as Node)) {
      setDragOverPosition(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragIdsJson = e.dataTransfer.getData('application/minflow-ids');
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

  return (
    <div className="relative">
      <div 
        ref={nodeRef}
        data-node-id={id}
        // Added pr-4 to ensure there is clickable empty space on the right for marquee selection
        className={`bullet-node-wrapper flex items-start py-1 pr-4 group transition-colors duration-100 relative rounded-sm ${isSelected ? 'bg-blue-100' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOverPosition === 'before' && <div className="drop-indicator absolute -top-0.5 left-0 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}
        {dragOverPosition === 'after' && <div className="drop-indicator absolute -bottom-0.5 left-0 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}
        {dragOverPosition === 'inside' && <div className="drop-indicator absolute -bottom-0.5 left-8 right-0 h-1 bg-blue-500 rounded-sm z-30 pointer-events-none" />}

        <div 
          className="relative flex-shrink-0 w-6 h-6 flex items-center justify-center -ml-2 mr-1 cursor-move group/bullet"
          draggable
          onDragStart={handleDragStart}
        >
          <div 
            className="absolute inset-0 rounded-full cursor-pointer z-20 transform scale-150"
            onClick={handleBulletClick}
            title="Click to zoom. Cmd+Click to collapse. Drag to move."
          ></div>
          <div className="absolute inset-0 rounded-full bg-gray-200 opacity-0 group-hover/bullet:opacity-100 transition-opacity duration-200 transform scale-75 pointer-events-none"></div>
          <div className={`z-10 rounded-full transition-all duration-200 pointer-events-none ${item.collapsed && hasChildren ? 'w-2 h-2 bg-gray-500 ring-2 ring-gray-300' : 'w-1.5 h-1.5 bg-gray-400 group-hover/bullet:bg-gray-600'}`}></div>
        </div>

        <textarea
          ref={inputRef}
          value={item.text}
          onChange={(e) => onUpdateText(id, e.target.value)}
          onKeyDown={handleKeyDownWrapper}
          onPaste={handlePaste}
          onFocus={() => setFocusedId(id)}
          rows={1}
          className="flex-grow bg-transparent border-none outline-none text-gray-800 text-base leading-tight placeholder-gray-300 font-medium resize-none overflow-hidden block py-[2px]"
          style={{ minHeight: '24px' }}
          placeholder=""
        />
      </div>

      {hasChildren && !item.collapsed && (
        <div className="ml-5 border-l border-gray-200 pl-2">
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
              onUpdateText={onUpdateText}
              onZoom={onZoom}
              onToggleCollapse={onToggleCollapse}
              onMoveItems={onMoveItems}
              onSelect={onSelect}
              onMultiLinePaste={onMultiLinePaste}
            />
          ))}
        </div>
      )}
    </div>
  );
};
