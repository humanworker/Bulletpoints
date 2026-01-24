
import React from 'react';
import { Item, ItemMap } from '../types';
import { stripHtml, findParentId } from '../utils';

interface TasksPaneProps {
  items: ItemMap;
  onNavigate: (parentId: string, taskId: string) => void;
  onCompleteTask: (id: string, parentId: string) => void;
}

export const TasksPane: React.FC<TasksPaneProps> = ({ items, onNavigate, onCompleteTask }) => {
  const tasks = Object.values(items).filter(i => i.isTask);

  const handleTaskClick = (task: Item) => {
    const parentId = findParentId(items, task.id);
    if (parentId) {
      onNavigate(parentId, task.id);
    }
  };

  const handleTaskComplete = (task: Item) => {
    const parentId = findParentId(items, task.id);
    if (parentId) {
      onCompleteTask(task.id, parentId);
    }
  };

  return (
    <div className="fixed top-24 left-8 bottom-8 w-56 overflow-y-auto hidden md:flex flex-col gap-3 z-30">
      <h2 className="font-bold text-gray-900 dark:text-gray-100 text-lg sticky top-0 bg-gray-50 dark:bg-gray-900 py-1">Tasks</h2>
      {tasks.length === 0 && <div className="text-gray-400 italic text-sm">No tasks found.</div>}
      {tasks.map(task => (
        <div key={task.id} className="flex items-start gap-2 group cursor-pointer hover:opacity-80" onClick={() => handleTaskClick(task)}>
          <input 
            type="checkbox" 
            className="mt-1 appearance-none w-3.5 h-3.5 border border-gray-400 dark:border-gray-500 rounded-sm bg-transparent checked:bg-blue-500 checked:border-blue-500 cursor-pointer shrink-0"
            onClick={(e) => { e.stopPropagation(); handleTaskComplete(task); }}
          />
          <div className="text-sm text-gray-700 dark:text-gray-300 font-medium line-clamp-3">
            {stripHtml(task.text) || 'Untitled'}
          </div>
        </div>
      ))}
    </div>
  );
};
