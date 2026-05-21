/**
 * Module-level global tracking the currently-hovered atom in Ketcher.
 * Populated by `useKetcherHover` (a document-level mousemove listener) and
 * read by `getActiveAtomIndex` as the fallback when no formal selection
 * exists. Implements the hover-then-press-key UX.
 */
let hoveredAtomId: number | null = null;

export function setHoveredAtomId(id: number | null): void {
  hoveredAtomId = id;
}

export function getHoveredAtomId(): number | null {
  return hoveredAtomId;
}
