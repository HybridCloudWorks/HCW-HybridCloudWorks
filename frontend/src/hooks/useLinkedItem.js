/**
 * A row a deep link names (#1013, #1014): `?<param>=<id>` in the address
 * bar. The row scrolls into view once and is marked, so the item the
 * Decision Center opened is the one the eye lands on.
 *
 * Read from `window.location`, not the router: the rows that use this render
 * inside pages and inside tests with and without a router, and the address
 * bar is already current when a linked page mounts — the router writes the
 * URL before it renders the route. Read once, when the row mounts: a tab
 * switch that drops the parameter remounts the row unmarked.
 */
import { useEffect, useRef, useState } from 'react';

/** The ring a linked row wears: the theme's primary colour, in both themes. */
export const LINKED_CLASS = 'ring-2 ring-primary ring-offset-2 ring-offset-background';

/** The value of `param` in the current address, or null. */
export function linkedId(param, search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get(param);
}

/**
 * @param {string} param the query parameter that names an item
 * @param {string|null|undefined} id this row's item
 * @returns {{ ref: React.RefObject, linked: boolean, linkedProps: object, linkedClassName: string }}
 */
export default function useLinkedItem(param, id) {
  const ref = useRef(null);
  const [linked] = useState(
    () => id !== undefined && id !== null && id !== '' && linkedId(param) === String(id)
  );

  useEffect(() => {
    if (linked) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [linked]);

  return {
    ref,
    linked,
    linkedProps: linked ? { 'data-linked': 'true', 'aria-current': 'true' } : {},
    linkedClassName: linked ? LINKED_CLASS : '',
  };
}
