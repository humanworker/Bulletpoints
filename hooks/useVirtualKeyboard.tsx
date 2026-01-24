
import { useEffect, RefObject } from 'react';

export const useVirtualKeyboard = (
  scrollContainerRef: RefObject<HTMLDivElement>, 
  isNavigatingRef: RefObject<boolean>
) => {
  useEffect(() => {
    const ensureCaretVisible = () => {
      if (isNavigatingRef.current) return;
      if (!window.visualViewport || !scrollContainerRef.current) return;
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      
      const range = selection.getRangeAt(0);
      
      // Get rect of current selection/caret relative to viewport
      const domRect = range.getBoundingClientRect();
      
      // Create a mutable copy since DOMRect properties are readonly
      const rect = {
          bottom: domRect.bottom,
          height: domRect.height,
          width: domRect.width,
          x: domRect.x,
          y: domRect.y
      };

      if (rect.height === 0 && rect.width === 0 && range.startContainer.nodeType === Node.ELEMENT_NODE) {
          // If range is collapsed and no rect, try the element itself (e.g. empty bullet)
          const el = range.startContainer as HTMLElement;
          const elRect = el.getBoundingClientRect();
          if (elRect) {
              // Create artificial rect at start of element
              rect.x = elRect.x;
              rect.y = elRect.y;
              rect.bottom = elRect.bottom;
          }
      }

      // We need to account for the mobile toolbar height (~60px) plus some padding
      // This ensures the text isn't hidden *behind* the toolbar that sits on top of the keyboard
      const toolbarHeight = 80; 
      
      // visualViewport.height is the height of the visible area (screen - keyboard)
      const viewportHeight = window.visualViewport.height;
      const visibleBottom = viewportHeight - toolbarHeight;

      // Check if caret bottom is below the visible safe area
      // Note: rect.bottom is coordinate relative to visual viewport top-left usually
      if (rect.bottom > visibleBottom) {
        const overflow = rect.bottom - visibleBottom;
        // Scroll the container to reveal the text
        // Use 'auto' behavior for typing responsiveness, 'smooth' for resize
        scrollContainerRef.current.scrollBy({ top: overflow, behavior: 'smooth' });
      }
    };

    // Listeners to trigger visibility check
    const handleResize = () => {
        // Wait a tick for layout to update after keyboard opens
        setTimeout(ensureCaretVisible, 100);
        setTimeout(ensureCaretVisible, 300); // Retry for slower devices
    };

    const handleInput = () => {
        // Check immediately while typing
        requestAnimationFrame(ensureCaretVisible);
    };
    
    // Attach listeners
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
        window.visualViewport.addEventListener('scroll', handleResize);
    }
    
    // Bubble up input events from contentEditable
    document.addEventListener('input', handleInput);
    
    // Also check on click/focus changes
    document.addEventListener('click', () => setTimeout(ensureCaretVisible, 100));

    return () => {
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', handleResize);
            window.visualViewport.removeEventListener('scroll', handleResize);
        }
        document.removeEventListener('input', handleInput);
    };
  }, []);
};
