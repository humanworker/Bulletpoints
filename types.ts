export interface Item {
  id: string;
  text: string;
  children: string[];
  isCompleted: boolean;
  collapsed: boolean;
}

export interface ItemMap {
  [id: string]: Item;
}

export interface WorkflowyState {
  items: ItemMap;
  rootId: string; // The constant absolute root of the data
}

export type DropPosition = 'before' | 'after' | 'inside';

export type Action =
  | { type: 'ADD_ITEM'; afterId: string | null; parentId: string; newId?: string }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'INDENT'; id: string; parentId: string }
  | { type: 'OUTDENT'; id: string; parentId: string }
  | { type: 'DELETE'; id: string; parentId: string }
  | { type: 'TOGGLE_COLLAPSE'; id: string }
  | { type: 'MOVE'; dragId: string; targetId: string; position: DropPosition }
  | { type: 'MOVE_ITEMS'; dragIds: string[]; targetId: string; position: DropPosition }
  | { type: 'LOAD_STATE'; state: WorkflowyState }
  | { type: 'UNDO' }
  | { type: 'REDO' };
