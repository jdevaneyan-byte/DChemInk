/**
 * Auto-layout / clean-up for the canvas. Two variants:
 *   - plain: Ketcher's native `layout()` (Indigo default fragment spacing).
 *   - grid:  layout(), then arrange disconnected fragments into a tidy grid.
 *
 * `layout()` regenerates 2D coords offline. Captions are now bound Data
 * S-groups living INSIDE each molecule node, so they translate WITH the
 * fragment automatically during grid arrangement and survive `layout()` — there
 * is no longer any separate text node to record or re-anchor. Serialised on the
 * same write chain as canvas appends.
 */

import {
  currentKetcher,
  runOnChain,
  type KetDoc,
  type KetMolecule,
  type MinimalKetcher,
} from "./canvas";
import { fragmentBBox, nearestFragmentIndex, type BBox } from "./ketGeom";

// Re-export the geometry helpers so existing import sites (and tests) can keep
// pulling them from "@/chem/layout". They actually live in ./ketGeom to avoid a
// canvas.ts ↔ layout.ts import cycle.
export { fragmentBBox, nearestFragmentIndex };
export type { BBox };

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

/**
 * Re-lay-out the canvas. With `grid: true`, also pack disconnected fragments
 * into a 3-column grid. Captions are bound Data S-groups inside each molecule
 * node, so they translate WITH their fragment automatically — no separate
 * re-anchor step is needed. No-op when the editor isn't ready or has no
 * fragments.
 */
export function cleanUpCanvas(
  opts: { grid: boolean },
  ketcher: MinimalKetcher | undefined = currentKetcher(),
): Promise<void> {
  const run = async (): Promise<void> => {
    if (!ketcher) return;

    // 1. Native layout (regenerates 2D coords; preserves fragment order and
    //    each molecule's sgroups, i.e. our bound captions).
    if (typeof ketcher.layout === "function") {
      await ketcher.layout();
    }

    // 2. Read post-layout KET.
    const ket = JSON.parse(await ketcher.getKet()) as KetDoc;
    const molRefs = ket.root.nodes
      .filter((n) => typeof n.$ref === "string")
      .map((n) => n.$ref as string);

    // 3. Optional grid arrangement: translate each fragment into its cell. The
    //    caption S-group rides along because it's part of the molecule node.
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

    // 4. Commit.
    await ketcher.setMolecule(JSON.stringify(ket));
  };

  return runOnChain(run);
}

// Re-export so test files / callers have a single import surface if desired.
export type { KetMolecule };
