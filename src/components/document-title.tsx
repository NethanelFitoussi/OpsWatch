'use client';

import { useEffect } from 'react';

/**
 * Sets the document title from a not-found or error page, which cannot export metadata. A rendered
 * <title> would sit next to the one the page's own metadata already put in the head; setting
 * document.title rewrites that one instead, and the previous text comes back on unmount.
 */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return null;
}
