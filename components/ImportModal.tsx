import React, { useState } from 'react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (text: string) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [text, setText] = useState('');

  if (!isOpen) return null;

  const handleImport = () => {
    onImport(text);
    onClose();
    setText('');
  };

  return (
    <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Import Data</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
            <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-md p-4 text-sm text-yellow-800 dark:text-yellow-200">
                <span className="font-bold">Warning:</span> Importing will overwrite all existing content. This cannot be undone unless you export your current data first.
            </div>
            
            <p className="mb-2 text-gray-700 dark:text-gray-300 text-sm">
                Paste your exported text below. Indentation (hyphens) determines the hierarchy.
            </p>
            
            <textarea
                className="w-full h-64 p-3 border border-gray-300 dark:border-gray-600 rounded-md font-mono text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none resize-none select-text"
                placeholder={`1\n-1a\n-1b\n--1ba\n2`}
                value={text}
                onChange={(e) => setText(e.target.value)}
            />
        </div>
        
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-900/50">
            <button 
                onClick={onClose}
                className="px-4 py-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
            >
                Cancel
            </button>
            <button 
                onClick={handleImport}
                disabled={!text.trim()}
                className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Import
            </button>
        </div>
      </div>
    </div>
  );
};