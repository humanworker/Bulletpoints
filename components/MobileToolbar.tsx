
import React, { useEffect, useState } from 'react';
import { Item } from '../types';

interface MobileToolbarProps {
  visible: boolean;
  isKeyboardOpen: boolean;
  item: Item | null;
  canIndent: boolean;
  canOutdent: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onIndent: () => void;
  onOutdent: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleTask: () => void;
  onToggleBold: () => void;
  onCycleSize: () => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
  onOpenLink: (url: string) => void;
}

const Icon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

interface ToolbarButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ label, onPress, disabled, active, danger, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    // Keep focus (and the keyboard) in the text field while tapping toolbar buttons
    onPointerDown={(e) => e.preventDefault()}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onPress}
    className={`shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition-colors active:bg-gray-200 dark:active:bg-gray-700 disabled:opacity-30 ${
      active
        ? 'text-blue-600 dark:text-blue-400'
        : danger
          ? 'text-red-600 dark:text-red-400'
          : 'text-gray-700 dark:text-gray-200'
    }`}
  >
    {children}
  </button>
);

const Divider = () => <div className="shrink-0 w-px h-6 mx-1 bg-gray-200 dark:bg-gray-700" />;

// Find the link (if any) the caret is currently inside
const getLinkAtCaret = (): string | null => {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!node) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  const link = el?.closest('a');
  return link && link.closest('[contenteditable]') ? (link as HTMLAnchorElement).href : null;
};

export const MobileToolbar: React.FC<MobileToolbarProps> = ({
  visible,
  isKeyboardOpen,
  item,
  canIndent,
  canOutdent,
  canMoveUp,
  canMoveDown,
  canUndo,
  canRedo,
  onIndent,
  onOutdent,
  onMoveUp,
  onMoveDown,
  onToggleTask,
  onToggleBold,
  onCycleSize,
  onToggleCollapse,
  onDelete,
  onUndo,
  onRedo,
  onDone,
  onOpenLink,
}) => {
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setLinkUrl(null);
      return;
    }
    const update = () => setLinkUrl(getLinkAtCaret());
    update();
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [visible]);

  const hasChildren = !!item && item.children.length > 0;
  const sizeLabel = item?.fontSize === 'large' ? 'H1' : item?.fontSize === 'medium' ? 'H2' : 'Aa';

  return (
    <div
      id="mobile-toolbar"
      data-visible={visible ? 'true' : 'false'}
      className={`fixed inset-x-0 z-50 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur transition-[transform,opacity] duration-200 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      style={{
        bottom: 'var(--kb-offset)',
        paddingBottom: isKeyboardOpen ? 0 : 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex items-center h-12">
        <div className="flex-1 min-w-0 flex items-center overflow-x-auto no-scrollbar px-1">
          <ToolbarButton label="Outdent" onPress={onOutdent} disabled={!canOutdent}>
            <Icon><path d="M7 21V3"/><path d="M22 12H11"/><path d="M15 8l-4 4 4 4"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Indent" onPress={onIndent} disabled={!canIndent}>
            <Icon><path d="M21 21V3"/><path d="M3 12h11"/><path d="M10 8l4 4-4 4"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Move up" onPress={onMoveUp} disabled={!canMoveUp}>
            <Icon><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Move down" onPress={onMoveDown} disabled={!canMoveDown}>
            <Icon><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></Icon>
          </ToolbarButton>

          <Divider />

          {linkUrl && (
            <ToolbarButton label="Open link" onPress={() => onOpenLink(linkUrl)} active>
              <Icon><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></Icon>
            </ToolbarButton>
          )}
          <ToolbarButton label="Toggle task" onPress={onToggleTask} active={!!item?.isTask}>
            <Icon><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Bold" onPress={onToggleBold} active={!!item?.isBold}>
            <Icon><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Text size" onPress={onCycleSize} active={!!item && item.fontSize !== undefined && item.fontSize !== 'small'}>
            <span className="text-sm font-bold">{sizeLabel}</span>
          </ToolbarButton>
          <ToolbarButton label={item?.collapsed ? 'Expand' : 'Collapse'} onPress={onToggleCollapse} disabled={!hasChildren}>
            {item?.collapsed ? (
              <Icon><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></Icon>
            ) : (
              <Icon><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></Icon>
            )}
          </ToolbarButton>

          <Divider />

          <ToolbarButton label="Undo" onPress={onUndo} disabled={!canUndo}>
            <Icon><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Redo" onPress={onRedo} disabled={!canRedo}>
            <Icon><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7"/></Icon>
          </ToolbarButton>
          <ToolbarButton label="Delete item" onPress={onDelete} danger>
            <Icon><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></Icon>
          </ToolbarButton>
        </div>

        <div className="shrink-0 pl-1 pr-1 border-l border-gray-200 dark:border-gray-700">
          <ToolbarButton label="Hide keyboard" onPress={onDone}>
            <Icon><rect x="2" y="4" width="20" height="12" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h8"/><path d="m9 19 3 3 3-3"/></Icon>
          </ToolbarButton>
        </div>
      </div>
    </div>
  );
};
