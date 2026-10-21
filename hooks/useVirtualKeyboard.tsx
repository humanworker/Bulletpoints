
import { useEffect, useState, RefObject } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { isNative } from '../native';

// Keeps the caret visible above the on-screen keyboard and the mobile toolbar,
// exposes the keyboard overlap as the --kb-offset CSS variable and reports whether the keyboard is open.
export const useVirtualKeyboard = (
  scrollContainerRef: RefObject<HTMLDivElement>,
  isNavigatingRef: RefObject<boolean>
) => {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    // Largest layout height seen; a much smaller one means the keyboard resized the page (Android)
    let fullHeight = window.innerHeight;
    let lastWidth = window.innerWidth;
    let nativeKeyboardOpen: boolean | null = null;

    const getVisibleBottom = () => (vv ? vv.offsetTop + vv.height : window.innerHeight);

    const updateKeyboardState = () => {
      if (window.innerWidth !== lastWidth) {
        // Rotation: start measuring the full height again
        lastWidth = window.innerWidth;
        fullHeight = window.innerHeight;
      }
      fullHeight = Math.max(fullHeight, window.innerHeight);
      // Keyboard overlapping the layout viewport (iOS Safari, or when the page isn't resized)
      const overlap = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      root.style.setProperty('--kb-offset', `${Math.round(overlap)}px`);

      const resized = window.innerHeight < fullHeight * 0.8;
      const open = nativeKeyboardOpen ?? (overlap > 80 || resized);
      setIsKeyboardOpen(open);
    };

    const ensureCaretVisible = () => {
      if (isNavigatingRef.current) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.isContentEditable) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      let rect = selection.getRangeAt(0).getBoundingClientRect();
      // Collapsed caret in an empty element has no rect; use the element instead
      if (rect.height === 0 && rect.width === 0) {
        rect = active.getBoundingClientRect();
      }

      const toolbar = document.getElementById('mobile-toolbar');
      const toolbarHeight = toolbar && toolbar.dataset.visible === 'true' ? toolbar.offsetHeight : 0;
      const visibleBottom = getVisibleBottom() - toolbarHeight - 12;
      const visibleTop = container.getBoundingClientRect().top + 8;

      if (rect.bottom > visibleBottom) {
        container.scrollTop += rect.bottom - visibleBottom;
      } else if (rect.top < visibleTop) {
        container.scrollTop -= visibleTop - rect.top;
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(ensureCaretVisible);
    };

    const handleViewportChange = () => {
      updateKeyboardState();
      schedule();
    };

    // Keyboard animations finish after the resize event on some devices, so check again shortly after
    const handleFocusIn = () => {
      schedule();
      setTimeout(schedule, 250);
    };

    vv?.addEventListener('resize', handleViewportChange);
    vv?.addEventListener('scroll', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    document.addEventListener('input', schedule);
    document.addEventListener('focusin', handleFocusIn);

    const nativeHandles: Promise<{ remove: () => Promise<void> }>[] = [];
    if (isNative) {
      nativeHandles.push(
        Keyboard.addListener('keyboardDidShow', () => {
          nativeKeyboardOpen = true;
          handleViewportChange();
        }),
        Keyboard.addListener('keyboardDidHide', () => {
          nativeKeyboardOpen = false;
          handleViewportChange();
        })
      );
    }

    updateKeyboardState();

    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', handleViewportChange);
      vv?.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      document.removeEventListener('input', schedule);
      document.removeEventListener('focusin', handleFocusIn);
      nativeHandles.forEach((handle) => handle.then((h) => h.remove()).catch(() => {}));
    };
  }, []);

  return { isKeyboardOpen };
};
