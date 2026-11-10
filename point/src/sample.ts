import { Item, ItemMap, OutlineState } from './types';

// A throwaway outline for developing and testing with ?local. Never used in the installed app.
type Seed = string | [string, Seed[]] | { text: string; done?: boolean; kids?: Seed[] };

const tree: Seed[] = [
  ['Today', [
    'Reply to Sam about the lease',
    'Book dentist',
    ['Groceries', ['Oat milk', 'Lemons', 'Coffee beans', { text: 'Bin bags', done: true }]],
    'Send invoice #214',
    'Water the plants',
    { text: 'Morning run', done: true },
    { text: 'Call the bank', done: true },
  ]],
  ['Work', [
    ['Q4 planning', ['Draft goals', 'Review budget with finance', 'Share with the team']],
    'Prepare Thursday demo',
    'Read the onboarding doc and leave comments where the steps are unclear or out of date, especially the part about getting access',
    'Follow up: <a href="https://example.com/report" class="underline">https://example.com/report</a>',
  ]],
  ['Home', ['Fix the hallway light', 'Renew insurance', 'Plan the garden beds']],
  ['Reading', ['The Overstory', 'Piranesi', 'A Pattern Language']],
  'Ideas',
  ['Trips', [['Lisbon', ['Flights', 'Where to stay']], 'Lake weekend']],
  'Someday',
  'Gift list',
  'Recipes to try',
  'Notes from the call',
  'Questions for the accountant',
  'Things to sell',
  'Films',
];

export const sampleState = (): OutlineState => {
  const items: ItemMap = {};
  let n = 0;
  const build = (seed: Seed): string => {
    const id = `s${n++}`;
    const spec = typeof seed === 'string' ? { text: seed } : Array.isArray(seed) ? { text: seed[0], kids: seed[1] } : seed;
    const item: Item = {
      id,
      text: spec.text,
      children: [],
      isCompleted: !!(spec as { done?: boolean }).done,
      collapsed: false,
      fontSize: 'small',
      isTask: false,
      isShortcut: false,
    };
    items[id] = item;
    item.children = ((spec as { kids?: Seed[] }).kids || []).map(build);
    return id;
  };
  const children = tree.map(build);
  items.root = { id: 'root', text: 'Home', children, isCompleted: false, collapsed: false, isTask: false };
  return { items, rootId: 'root' };
};
