import { useState, useRef, useCallback } from 'react';
import { isMobile } from '../utils';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const useMarqueeSelection = (
  selectedIds: Set<string>,
  setSelectedIds: (ids: Set<string>) => void
) => {
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null);
  const isSelectingRef = useRef(false);
  const initialSelectionRef = useRef<Set<string>>(new Set());

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Disable selection completely on mobile
    if (isMobile()) return;

    // 1. Handle Text Nodes (clicks on text content)
    let target = e.target as Node;
    if (target.nodeType === Node.TEXT_NODE) {
      target = target.parentNode as Node;
    }
    const el = target as HTMLElement;
    
    // 2. Ignore interactive elements AND the node wrapper itself
    // Ignoring the wrapper ensures that tapping/clicking on the item's "row" 
    // passes through to the Item's own onClick handlers (for focus) 
    // instead of triggering marquee start (which would blur focus).
    if (
        el.closest('[contenteditable]') || 
        el.closest('.cursor-move') || 
        el.closest('button') || 
        el.closest('a') ||
        el.closest('input') || 
        el.closest('textarea') ||
        el.closest('.bullet-node-wrapper')
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
  }, [selectedIds, setSelectedIds]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
  }, [setSelectedIds]);

  const handleMouseUp = useCallback(() => {
    isSelectingRef.current = false;
    setSelectionRect(null);
    selectionStartRef.current = null;
  }, []);

  return {
    selectionRect,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp
  };
};