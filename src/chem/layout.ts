/**
 * Auto-layout / clean-up for the canvas. Two variants:
 *   - plain: Ketcher's native `layout()` (Indigo default fragment spacing).
 *   - grid:  layout(), then arrange disconnected fragments into a tidy grid.
 *
 * `layout()` regenerates 2D coords offline. It preserves text nodes and
 * fragment order, but it MOVES molecules while leaving text where it was — so
 * captions become detached. We record which fragment each caption belongs to
 * BEFORE layout, then re-anchor a fresh caption under that (possibly moved)
 * fragment afterwards. Serialised on the same write chain as canvas appends.
 */

import {
  currentKetcher,
  runOnChain,
  makeMultilineTextNode,
  textNodeLines,
  type KetDoc,
  type KetMolecule,
  type MinimalKetcher,
} from "./canvas";

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

/**
 * Per-fragment translation that arranges `bboxes` into a `cols`-wide grid.
 * Cell size is the largest fragment width/height (plus `pad`); each fragment's
 * bbox top-left is moved to its target cell's top-left so internal geometry is
 * untouched. Null bboxes get a zero translation. The grid's top-left anchors at
 * the top-left of the first non-null fragment so absolute placement is stable.
 */
export function gridTranslations(
  bboxes: (BBox | null)[],
  cols: number,
  pad: number,
): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = bboxes.map(() => ({ dx: 0, dy: 0 }));
  const ncols = Math.max(1, cols);

  let maxW = 0;
  let maxH = 0;
  let anchorX = 0;
  let anchorYTop = 0;
  let haveAnchor = false;
  for (const bb of bboxes) {
    if (!bb) continue;
    maxW = Math.max(maxW, bb.maxX - bb.minX);
    maxH = Math.max(maxH, bb.maxY - bb.minY);
    if (!haveAnchor) {
      anchorX = bb.minX;
      anchorYTop = bb.maxY; // top edge (largest y renders highest)
      haveAnchor = true;
    }
  }

  const cellW = maxW + pad;
  const cellH = maxH + pad;

  let slot = 0;
  for (let i = 0; i < bboxes.length; i++) {
    const bb = bboxes[i];
    if (!bb) continue;
    const col = slot % ncols;
    const row = Math.floor(slot / ncols);
    slot++;
    // Target top-left for this cell. Rows go DOWNWARD on the canvas, i.e.
    // decreasing y, so each successive row subtracts a cell height.
    const targetMinX = anchorX + col * cellW;
    const targetMaxY = anchorYTop - row * cellH;
    out[i] = { dx: targetMinX - bb.minX, dy: targetMaxY - bb.maxY };
  }

  return out;
}

/** Translate every atom location of a molecule fragment in place. */
function translateFragment(mol: KetMolecule, dx: number, dy: number): void {
  for (const a of mol.atoms ?? []) {
    if (a.location) {
      a.location = [a.location[0] + dx, a.location[1] + dy, a.location[2]];
    }
  }
}

const GRID_COLS = 3;
const GRID_PAD = 2;
const CAPTION_GAP = 1.5; // gap below a fragment before the first caption line
const LINE = 0.8; // approx KET text line height

/**
 * Re-lay-out the canvas. With `grid: true`, also pack disconnected fragments
 * into a 3-column grid. In both cases captions are re-anchored under their
 * original molecule. No-op when the editor isn't ready or has no fragments.
 */
export function cleanUpCanvas(
  opts: { grid: boolean },
  ketcher: MinimalKetcher | undefined = currentKetcher(),
): Promise<void> {
  const run = async (): Promise<void> => {
    if (!ketcher) return;

    // 1. Read pre-layout KET and record caption→fragment associations.
    const preKet = JSON.parse(await ketcher.getKet()) as KetDoc;
    const preMolRefs = preKet.root.nodes
      .filter((n) => typeof n.$ref === "string")
      .map((n) => n.$ref as string);
    const preBBoxes = preMolRefs.map((ref) =>
      fragmentBBox(preKet[ref] as KetMolecule | undefined),
    );

    const textNodes = preKet.root.nodes.filter((n) => n.type === "text");
    // assoc[textIndex] = fragmentIndex (or -1); also keep each caption's lines.
    const assoc: number[] = [];
    const captionLines: string[][] = [];
    for (const t of textNodes) {
      const pos = (t.data as { position?: { x: number; y: number } } | undefined)
        ?.position;
      assoc.push(pos ? nearestFragmentIndex(pos, preBBoxes) : -1);
      captionLines.push(textNodeLines(t));
    }

    // 2. Native layout (preserves fragment order and text nodes).
    if (typeof ketcher.layout === "function") {
      await ketcher.layout();
    }

    // 3. Read post-layout KET. Fragment order is preserved, so assoc still maps.
    const ket = JSON.parse(await ketcher.getKet()) as KetDoc;
    const molRefs = ket.root.nodes
      .filter((n) => typeof n.$ref === "string")
      .map((n) => n.$ref as string);

    // 4. Optional grid arrangement: translate each fragment into its cell.
    if (opts.grid) {
      const bboxes = molRefs.map((ref) =>
        fragmentBBox(ket[ref] as KetMolecule | undefined),
      );
      const translations = gridTranslations(bboxes, GRID_COLS, GRID_PAD);
      for (let i = 0; i < molRefs.length; i++) {
        const { dx, dy } = translations[i];
        if (dx !== 0 || dy !== 0) {
          translateFragment(ket[molRefs[i]] as KetMolecule, dx, dy);
        }
      }
    }

    // 5. Drop the stale text nodes; we'll re-anchor fresh ones.
    ket.root.nodes = ket.root.nodes.filter((n) => n.type !== "text");

    // 6. Re-anchor captions under their (possibly moved) fragment, stacking
    //    multiple captions under the same fragment so they don't overlap.
    const stackBottom: Record<number, number> = {};
    for (let t = 0; t < textNodes.length; t++) {
      const fragIdx = assoc[t];
      const lines = captionLines[t];
      if (fragIdx < 0 || fragIdx >= molRefs.length) continue;
      const bb = fragmentBBox(ket[molRefs[fragIdx]] as KetMolecule | undefined);
      if (!bb) continue;

      const top = stackBottom[fragIdx];
      const startY = top === undefined ? bb.minY - CAPTION_GAP : top;
      ket.root.nodes.push(makeMultilineTextNode(lines, bb.minX, startY));
      // Next caption under this fragment starts below this whole block + a gap.
      stackBottom[fragIdx] = startY - LINE * lines.length - LINE;
    }

    // 7. Commit.
    await ketcher.setMolecule(JSON.stringify(ket));
  };

  return runOnChain(run);
}

// Re-export so test files / callers have a single import surface if desired.
export type { KetMolecule };
