// Item text is stored as HTML (the main app saves contenteditable innerHTML), so Point does too.

const scratch = document.createElement('div');

export const htmlToPlain = (html: string): string => {
  scratch.innerHTML = html;
  return scratch.textContent || '';
};

export const plainToHtml = (plain: string): string => {
  scratch.textContent = plain;
  return scratch.innerHTML;
};

const URL_TEST = /((https?:\/\/|www\.)[^\s]+)/;

// Wrap bare URLs in the same anchors the main app creates
export const linkify = (html: string): string => {
  if (!URL_TEST.test(html)) return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('a')) continue;
    if (URL_TEST.test(node.nodeValue || '')) targets.push(node as Text);
  }
  if (targets.length === 0) return html;

  for (const textNode of targets) {
    const text = textNode.nodeValue || '';
    const fragment = document.createDocumentFragment();
    const urlRegex = /((?:https?:\/\/|www\.)[^\s]+)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      const url = match[0];
      const a = document.createElement('a');
      a.href = url.startsWith('www.') ? `http://${url}` : url;
      a.textContent = url;
      a.className = 'text-blue-500 dark:text-blue-400 underline hover:text-blue-600 dark:hover:text-blue-300 cursor-pointer';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      fragment.appendChild(a);
      last = match.index + url.length;
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  }
  return div.innerHTML;
};

// What an editor's innerHTML becomes before it is saved
export const cleanEditedHtml = (html: string): string => {
  const cleaned = html
    .replace(/<div><br><\/div>/gi, ' ')
    .replace(/<\/?div[^>]*>/gi, ' ')
    .replace(/(<br\s*\/?>\s*)+$/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return htmlToPlain(cleaned).trim() === '' ? '' : linkify(cleaned);
};

export const isBlankHtml = (html: string): boolean => htmlToPlain(html).trim() === '';
