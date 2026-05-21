import { useEffect } from "react";
import { setHoveredAtomId, getHoveredAtomId } from "./hoverState";

interface FindItemResult {
  map?: string;
  id?: number;
}

interface KetcherEditorWithHover {
  editor?: {
    findItem?: (
      ev: MouseEvent,
      types?: readonly string[],
    ) => FindItemResult | null;
  };
}

/**
 * Mount once at the app root. Listens for `mousemove` on the document and
 * caches the currently-hovered atom id in `hoverState`. Hotkey handlers
 * then read it as the implicit "active atom" — the hover-then-key UX.
 *
 * `editor.findItem(event)` is Ketcher's hit-test API: returns
 * `{map: 'atoms', id: number}` when the cursor is over an atom, `null`
 * otherwise.
 */
export function useKetcherHover(): void {
  useEffect(() => {
    function onMove(ev: MouseEvent) {
      const editor = (window.ketcher as unknown as KetcherEditorWithHover)
        ?.editor;
      if (!editor?.findItem) return;
      try {
        // Must invoke as a method to preserve `this` (findItem reads
        // this.render internally) — don't destructure into a free var.
        const item = editor.findItem(ev);
        if (item?.map === "atoms" && typeof item.id === "number") {
          setHoveredAtomId(item.id);
        } else {
          setHoveredAtomId(null);
        }
      } catch {
        setHoveredAtomId(null);
      }
    }
    document.addEventListener("mousemove", onMove, { capture: true });
    // Expose for tests to verify hover state without poking React internals.
    (window as unknown as { __dcheminkGetHoverAtomId?: () => number | null }).__dcheminkGetHoverAtomId = getHoveredAtomId;
    return () => {
      document.removeEventListener("mousemove", onMove, { capture: true });
    };
  }, []);
}
