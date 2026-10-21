import React, { useEffect } from 'react';

export interface ToastMessage {
  id: number;
  message: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  raised: boolean; // Sit above the mobile toolbar / keyboard
  onUndo: () => void;
  onDismiss: () => void;
}

const TOAST_DURATION_MS = 4000;

export const Toast: React.FC<ToastProps> = ({ toast, raised, onUndo, onDismiss }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[55] w-[calc(100%-2rem)] max-w-sm"
      style={{
        bottom: raised
          ? 'calc(var(--kb-offset) + 60px)'
          : 'calc(16px + env(safe-area-inset-bottom))',
      }}
    >
      <div
        key={toast.id}
        role="status"
        className="animate-toast-in flex items-center gap-3 pl-4 pr-2 py-2 rounded-xl shadow-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
      >
        <span className="flex-1 text-sm">{toast.message}</span>
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onUndo();
            onDismiss();
          }}
          className="shrink-0 px-3 h-9 rounded-lg text-sm font-bold text-blue-300 dark:text-blue-600 active:bg-white/10 dark:active:bg-black/10"
        >
          Undo
        </button>
      </div>
    </div>
  );
};
