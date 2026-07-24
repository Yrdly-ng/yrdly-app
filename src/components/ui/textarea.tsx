
import * as React from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';

import {cn} from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, onFocus, onBlur, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const internalRef = useRef<HTMLTextAreaElement | null>(null);
    
    // Use both refs to ensure compatibility
    const setRefs = useCallback((element: HTMLTextAreaElement | null) => {
      internalRef.current = element;
      if (typeof ref === 'function') {
        ref(element);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = element;
      }
    }, [ref]);

    const handleFocus = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
      setIsFocused(true);
      onFocus?.(e);
    }, [onFocus]);

    const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
      setIsFocused(false);
      onBlur?.(e);
    }, [onBlur]);

    // Restore focus if it was lost due to re-render
    useEffect(() => {
      if (isFocused && internalRef.current && document.activeElement !== internalRef.current) {
        // Small delay to ensure the DOM is stable
        const timer = setTimeout(() => {
          if (internalRef.current && isFocused) {
            internalRef.current.focus();
          }
        }, 0);
        return () => clearTimeout(timer);
      }
    }, [isFocused]);

    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className
        )}
        ref={setRefs}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
