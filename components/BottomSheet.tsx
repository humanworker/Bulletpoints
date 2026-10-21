import React, { useRef } from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

const DISMISS_DISTANCE = 90;

export const BottomSheet: React.FC<BottomSheetProps> = ({ isOpen, onClose, title, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; pointerId: number } | null>(null);

  if (!isOpen) return null;

  // Drag the handle/header down to dismiss
  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (panelRef.current) panelRef.current.style.transition = '';
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !panelRef.current) return;
    const dy = Math.max(0, e.clientY - drag.startY);
    panelRef.current.style.transform = `translateY(${dy}px)`;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !panelRef.current) return;
    dragRef.current = null;
    const dy = e.clientY - drag.startY;
    if (dy > DISMISS_DISTANCE) {
      onClose();
      return;
    }
    panelRef.current.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
    panelRef.current.style.transform = '';
  };

  return (
    <div className="fixed inset-0 z-[60]" onMouseDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 max-h-[80vh] flex flex-col bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl animate-sheet-in"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="shrink-0 cursor-grab"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="flex justify-center pt-2.5 pb-2">
            <div className="w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
          </div>
          {title && <h2 className="px-5 pb-2 text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">{children}</div>
      </div>
    </div>
  );
};

interface SheetRowProps {
  label: React.ReactNode;
  detail?: React.ReactNode;
  onPress: () => void;
  leading?: React.ReactNode;
}

export const SheetRow: React.FC<SheetRowProps> = ({ label, detail, onPress, leading }) => (
  <button
    type="button"
    onClick={onPress}
    className="w-full min-h-[48px] flex items-center gap-3 px-3 py-2 rounded-xl text-left text-base text-gray-900 dark:text-gray-100 active:bg-gray-100 dark:active:bg-gray-700"
  >
    {leading}
    <span className="flex-1 min-w-0 line-clamp-2">{label}</span>
    {detail && <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500">{detail}</span>}
  </button>
);
