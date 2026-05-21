/**
 * Tiny pure geometry helpers over KET molecule fragments, factored out so BOTH
 * `canvas.ts` and `layout.ts` can use them without an import cycle (`layout.ts`
 * already imports from `canvas.ts`, so importing these back into `canvas.ts`
 * from `layout.ts` would loop). `layout.ts` re-exports them for back-compat.
 */

import type { KetMolecule } from "./canvas";

/** Axis-aligned bounding box of a molecule's atom locations. */
export interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Bounding box of a molecule fragment from its atom `location`s. Returns `null`
 * when the fragment has no positioned atoms.
 */
export function fragmentBBox(mol: KetMolecule | undefined): BBox | null {
  const atoms = mol?.atoms ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const a of atoms) {
    if (a.location) {
      xs.push(a.location[0]);
      ys.push(a.location[1]);
    }
  }
  if (xs.length === 0) return null;
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * Index (in the supplied `fragments` order) of the fragment a caption belongs
 * to. We prefer a fragment that (a) horizontally overlaps the text's x and
 * (b) sits ABOVE the text (captions render just below their molecule; smaller y
 * is lower on the canvas, so "above" means the fragment's minY > text y). Among
 * candidates we pick the nearest by distance from the text position to the
 * fragment's bbox center; if none qualify, fall back to the globally nearest
 * fragment. Returns -1 when there are no positioned fragments.
 */
export function nearestFragmentIndex(
  textPos: { x: number; y: number },
  fragments: (BBox | null)[],
): number {
  let bestPreferred = -1;
  let bestPreferredDist = Infinity;
  let bestAny = -1;
  let bestAnyDist = Infinity;

  for (let i = 0; i < fragments.length; i++) {
    const bb = fragments[i];
    if (!bb) continue;
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const dist = Math.hypot(textPos.x - cx, textPos.y - cy);

    if (dist < bestAnyDist) {
      bestAnyDist = dist;
      bestAny = i;
    }

    const overlapsX = textPos.x >= bb.minX && textPos.x <= bb.maxX;
    const above = bb.minY > textPos.y; // fragment sits above the caption
    if (overlapsX && above && dist < bestPreferredDist) {
      bestPreferredDist = dist;
      bestPreferred = i;
    }
  }

  return bestPreferred !== -1 ? bestPreferred : bestAny;
}
