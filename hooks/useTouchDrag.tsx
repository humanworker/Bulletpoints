import React, { useRef, useState, useCallback, RefObject } from 'react';
import { DropPosition, ItemMap } from '../types';
import { isAncestor } from '../utils';
import { haptic } from '../native';

const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE = 10;
const AUTOSCROLL_EDGE = 70;
const AUTOSCROLL_SPEED = 12;

interface DropTarget {
  targetId: string;
  position: DropPosition;
  indicator: { top: number; left: number; width: number };
}

// Long-press a bullet to pick an item up, drag to reorder, release to drop.
export const useTouchDrag = (
  scrollContainerRef: RefObject<HTMLDivElement>,
  getItems: () => ItemMap,
  onDrop: (dragIds: string[], targetId: string, position: DropPosition) => void
) => {
  const [draggingIds, setDraggingIds] = useState<Set<string> | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const suppressClickUntilRef = useRef(0);

  const startTouchDrag = useCallback((e: React.PointerEvent, id: string) => {
    if (e.pointerType !== 'touch') return;

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let active = false;
    let target: DropTarget | null = null;
    let scrollFrame = 0;

    const computeTarget = () => {
      const el = document.elementFromPoint(lastX, lastY)?.closest('.bullet-node-wrapper') as HTMLElement | null;
      const targetId = el?.getAttribute('data-node-id');
      const items = getItems();
      if (!el || !targetId || targetId === id || isAncestor(items, targetId, id)) {
        target = null;
      } else {
        const rect = el.getBoundingClientRect();
        const y = lastY - rect.top;
        const position: DropPosition = y < rect.height * 0.3 ? 'before' : y > rect.height * 0.7 ? 'after' : 'inside';
        const indent = position === 'inside' ? 32 : 0;
        target = {
          targetId,
          position,
          indicator: {
            top: (position === 'before' ? rect.top : rect.bottom) - 2,
            left: rect.left + indent,
            width: rect.width - indent,
          },
        };
      }
      setDropTarget(target);
    };

    const autoScroll = () => {
      const container = scrollContainerRef.current;
      if (!active || !container) return;
      const rect = container.getBoundingClientRect();
      let delta = 0;
      if (lastY < rect.top + AUTOSCROLL_EDGE) delta = -AUTOSCROLL_SPEED;
      else if (lastY > rect.bottom - AUTOSCROLL_EDGE) delta = AUTOSCROLL_SPEED;
      if (delta !== 0) {
        container.scrollTop += delta;
        computeTarget();
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    };

    const begin = () => {
      active = true;
      haptic('medium');
      // Picking up an item shouldn't leave the keyboard open over the list
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl?.isContentEditable) activeEl.blur();
      setDraggingIds(new Set([id]));
      computeTarget();
      scrollFrame = requestAnimationFrame(autoScroll);
    };

    const timer = setTimeout(begin, LONG_PRESS_MS);

    const cleanup = () => {
      clearTimeout(timer);
      cancelAnimationFrame(scrollFrame);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      setDraggingIds(null);
      setDropTarget(null);
    };

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!active) {
        if (Math.hypot(lastX - startX, lastY - startY) > MOVE_TOLERANCE) cleanup();
        return;
      }
      ev.preventDefault();
      computeTarget();
    };

    const handleUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const wasActive = active;
      const finalTarget = target;
      active = false;
      cleanup();
      if (!wasActive) return;
      // The release would otherwise count as a tap on the bullet (zoom)
      suppressClickUntilRef.current = Date.now() + 500;
      if (finalTarget) {
        onDrop([id], finalTarget.targetId, finalTarget.position);
        haptic('light');
      }
    };

    const handleCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      active = false;
      cleanup();
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
  }, [scrollContainerRef, getItems, onDrop]);

  const consumeDragClick = useCallback(() => Date.now() < suppressClickUntilRef.current, []);

  return { draggingIds, dropTarget, startTouchDrag, consumeDragClick };
};
