// Same document shape as the main Bulletpoints app, so both read and write the same data.
export interface Item {
  id: string;
  text: string; // HTML, exactly as the main app stores it
  children: string[];
  isCompleted: boolean;
  collapsed: boolean;
  fontSize?: 'small' | 'medium' | 'large';
  isTask?: boolean;
  isShortcut?: boolean;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderlined?: boolean;
  /** Set by Point when the line has been sent to Todoist; empty or absent otherwise */
  todoistId?: string;
}

export type ItemMap = Record<string, Item>;

export interface OutlineState {
  items: ItemMap;
  rootId: string;
}

export type SyncStatus = 'saved' | 'saving' | 'error' | 'local';
