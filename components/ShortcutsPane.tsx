
import React from 'react';
import { Item, ItemMap } from '../types';
import { stripHtml } from '../utils';

interface ShortcutsPaneProps {
  items: ItemMap;
  onNavigate: (id: string) => void;
}

export const ShortcutsPane: React.FC<ShortcutsPaneProps> = ({ items, onNavigate }) => {
  const shortcuts = Object.values(items).filter(i => i.isShortcut);

  const handleClick = (item: Item) => {
    onNavigate(item.id);
  };

  return (
    <div className="fixed top-24 right-8 bottom-8 w-56 overflow-y-auto hidden md:flex flex-col gap-3 z-30">
      <h2 className="font-bold text-gray-900 dark:text-gray-100 text-lg sticky top-0 bg-gray-50 dark:bg-gray-900 py-1">Shortcuts</h2>
      {shortcuts.length === 0 && <div className="text-gray-400 italic text-sm">No shortcuts found.</div>}
      {shortcuts.map(item => (
        <div key={item.id} className="flex items-start gap-2 group cursor-pointer hover:opacity-80" onClick={() => handleClick(item)}>
          <div className="text-sm text-gray-700 dark:text-gray-300 font-medium line-clamp-3">
            {stripHtml(item.text) || 'Untitled'}
          </div>
        </div>
      ))}
    </div>
  );
};
