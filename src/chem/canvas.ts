/**
 * Canvas append helpers shared by the Name→structure box and the paste-a-name
 * handler, so both ADD a structure (never wipe the canvas) and caption it with
 * its name underneath.
 *
 * We add via Ketcher's `addFragment` (which keeps existing molecules AND text),
 * then read the KET back, drop a text caption below the newly-added fragment,
 * and re-set the whole KET (preserving everything because the KET is the full
 * document with explicit coordinates).
 */

import { registerName } from "./nameRegistry";
import { fragmentBBox, nearestFragmentIndex } from "./ketGeom";

/** Minimal slice of the Ketcher API we use here. */
export interface MinimalKetcher {
  addFragment(structStr: string): Promise<void | undefined>;
  getKet(): Promise<string>;
  setMolecule(structStr: string): Promise<void | undefined>;
  layout?(): Promise<void | undefined>;
}

/** Loosely-typed KET document. */
export interface KetNode {
  $ref?: string;
  type?: string;
  data?: { content?: string; position?: { x: number; y: number; z?: number } };
}
export interface KetAtom {
  location?: [number, number, number];
}
export interface KetMolecule {
  atoms?: KetAtom[];
  stereoFlagPosition?: { x: number; y: number; z: number };
}
export interface KetDoc {
  root: { nodes: KetNode[] };
  [key: string]: unknown;
}

export function currentKetcher(): MinimalKetcher | undefined {
  return (window as unknown as { ketcher?: MinimalKetcher }).ketcher;
}

/** Capitalise the first letter (rest untouched): "aspirin" → "Aspirin". */
export function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Approx KET-units per text character (Ketcher's caption font ≈ this wide).
 * Measured: text ≈ 6.5 px/char ÷ ~44 px per KET unit ≈ 0.15. */
const CHAR_W = 0.15;

/**
 * X position to anchor a caption so it sits visually CENTERED under a fragment.
 * Ketcher LEFT-anchors text at the position, so we shift left by half the
 * widest line's estimated width. Used everywhere captions are placed so the
 * re-anchor hook doesn't fight the creation site.
 */
export function captionAnchorX(minX: number, maxX: number, lines: string[]): number {
  const center = (minX + maxX) / 2;
  const maxChars = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return center - (maxChars * CHAR_W) / 2;
}

let uid = 0;

/** Build a KET text node (Draft.js raw-content string) at a position. */
function makeTextNode(label: string, x: number, y: number): KetNode {
  const content = JSON.stringify({
    blocks: [
      {
        key: `cap${uid++}`,
        text: label,
        type: "unstyled",
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
        data: {},
      },
    ],
    entityMap: {},
  });
  return { type: "text", data: { content, position: { x, y, z: 0 } } } as KetNode;
}

/**
 * Mutate `ket` in place, adding a `label` caption centered just below the
 * last molecule fragment (the one most recently added — KET keeps disconnected
 * fragments as separate molecule nodes in insertion order). No-op if there is
 * no molecule node or it has no atom coordinates.
 */
export function addCaptionToLastFragment(ket: KetDoc, label: string): KetDoc {
  const molRefs = ket.root.nodes
    .filter((n) => typeof n.$ref === "string")
    .map((n) => n.$ref as string);
  if (molRefs.length === 0) return ket;

  const lastRef = molRefs[molRefs.length - 1];
  const mol = ket[lastRef] as KetMolecule | undefined;
  const atoms = mol?.atoms ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const a of atoms) {
    if (a.location) {
      xs.push(a.location[0]);
      ys.push(a.location[1]);
    }
  }
  if (xs.length === 0) return ket;

  const cx = captionAnchorX(Math.min(...xs), Math.max(...xs), [label]);
  const belowY = Math.min(...ys) - 1.5; // smaller y renders lower on canvas
  ket.root.nodes.push(makeTextNode(label, cx, belowY));
  return ket;
}

/** How many text lines a KET text node holds (Draft.js block count). */
export function countTextLines(node: KetNode): number {
  const content = (node.data as { content?: string } | undefined)?.content;
  if (!content) return 1;
  try {
    const blocks = (JSON.parse(content) as { blocks?: unknown[] }).blocks;
    return Array.isArray(blocks) && blocks.length > 0 ? blocks.length : 1;
  } catch {
    return 1;
  }
}

/**
 * Extract the plain-text lines from a KET text node (Draft.js block texts).
 * Falls back to a single empty line if the content can't be parsed.
 */
export function textNodeLines(node: KetNode): string[] {
  const content = (node.data as { content?: string } | undefined)?.content;
  if (!content) return [""];
  try {
    const blocks = (JSON.parse(content) as { blocks?: { text?: string }[] }).blocks;
    if (Array.isArray(blocks) && blocks.length > 0) {
      return blocks.map((b) => b.text ?? "");
    }
  } catch {
    /* fall through */
  }
  return [""];
}

/** Build a multi-line KET text node (Draft.js raw-content string) at a position. */
export function makeMultilineTextNode(lines: string[], x: number, y: number): KetNode {
  const content = JSON.stringify({
    blocks: lines.map((text) => ({
      key: `cap${uid++}`,
      text,
      type: "unstyled",
      depth: 0,
      inlineStyleRanges: [],
      entityRanges: [],
      data: {},
    })),
    entityMap: {},
  });
  return { type: "text", data: { content, position: { x, y, z: 0 } } } as KetNode;
}

/**
 * Stamp a centered, multi-line text block UNDER a molecule on the canvas
 * (one line per `lines[]` entry). By default the block lands under the LAST
 * molecule fragment; if `matchHeavyAtoms` is given, it prefers the molecule
 * whose `atoms.length === matchHeavyAtoms` so the block sits below the molecule
 * whose properties are shown.
 *
 * Serialised on the same global `chain` as `appendSmilesToCanvas` so it does not
 * race other canvas writes. No-op if `lines` is empty or there is no molecule
 * node.
 */
export function appendPropertyBlock(
  lines: string[],
  matchHeavyAtoms?: number,
  ketcher: MinimalKetcher | undefined = currentKetcher(),
): Promise<void> {
  const run = async (): Promise<void> => {
    if (lines.length === 0) return;
    if (!ketcher) return;
    const ket = JSON.parse(await ketcher.getKet()) as KetDoc;

    const molRefs = ket.root.nodes
      .filter((n) => typeof n.$ref === "string")
      .map((n) => n.$ref as string);
    if (molRefs.length === 0) return;

    let targetRef = molRefs[molRefs.length - 1];
    if (matchHeavyAtoms !== undefined) {
      const matched = molRefs.find(
        (ref) => (ket[ref] as KetMolecule | undefined)?.atoms?.length === matchHeavyAtoms,
      );
      if (matched) targetRef = matched;
    }

    const mol = ket[targetRef] as KetMolecule | undefined;
    const atoms = mol?.atoms ?? [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const a of atoms) {
      if (a.location) {
        xs.push(a.location[0]);
        ys.push(a.location[1]);
      }
    }
    if (xs.length === 0) return;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const molBottom = Math.min(...ys);
    // Start just below the molecule, then drop below any existing text already
    // sitting under it (e.g. the name caption, or a previous property block) so
    // the new block doesn't overlap. Smaller y renders lower on the canvas.
    let belowY = molBottom - 1.5;
    const LINE = 0.8; // approx text line height in KET units
    for (const node of ket.root.nodes) {
      if (node.type !== "text") continue;
      const pos = (node.data as { position?: { x: number; y: number } } | undefined)
        ?.position;
      if (!pos || pos.y >= molBottom) continue; // only text below the molecule
      if (pos.x < minX - 3 || pos.x > maxX + 3) continue; // roughly under it
      const nLines = countTextLines(node);
      const bottom = pos.y - LINE * nLines - LINE; // clear the whole block + gap
      if (bottom < belowY) belowY = bottom;
    }
    const centerX = captionAnchorX(minX, maxX, lines);
    ket.root.nodes.push(makeMultilineTextNode(lines, centerX, belowY));
    await ketcher.setMolecule(JSON.stringify(ket));
  };
  const result = chain.then(run, run);
  // Keep the chain alive regardless of whether this call succeeded.
  chain = result.catch(() => undefined);
  return result;
}

// Serialises all canvas appends app-wide: two appends firing within the ~0.7s
// name-resolution window would otherwise race (read-modify-write of the KET).
let chain: Promise<unknown> = Promise.resolve();

/**
 * Enqueue a read-modify-write task on the shared canvas-write chain so it does
 * not race other canvas mutations (appends, captions, layout). The chain stays
 * alive whether or not `task` resolves or rejects.
 */
export function runOnChain<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task);
  chain = result.catch(() => undefined);
  return result;
}

/**
 * Replace a molecule's caption(s) with ONE consolidated, centered block.
 *
 * Used by "Paste to canvas": the molecule already carries its name caption, so
 * stamping a separate property block would duplicate the name and read as two
 * left-aligned blocks. Instead we REMOVE every existing text caption belonging
 * to the target molecule and drop a single multi-line block (name title +
 * chosen property rows) centered just below it.
 *
 * Target molecule: the fragment whose `atoms.length === matchHeavyAtoms` if
 * given, else the LAST molecule fragment. "Belongs to" is decided by
 * `nearestFragmentIndex` over the fragment bounding boxes.
 *
 * Serialised on the shared canvas-write chain so it doesn't race other writes.
 * No-op if there is no editor, no target fragment. If `lines` is empty the old
 * caption(s) are still removed (no replacement block is added).
 */
export function setCaptionBlock(
  lines: string[],
  matchHeavyAtoms?: number,
  ketcher: MinimalKetcher | undefined = currentKetcher(),
): Promise<void> {
  return runOnChain(async () => {
    if (!ketcher) return;
    const ket = JSON.parse(await ketcher.getKet()) as KetDoc;

    const molRefs = ket.root.nodes
      .filter((n) => typeof n.$ref === "string")
      .map((n) => n.$ref as string);
    if (molRefs.length === 0) return;

    const bboxes = molRefs.map((ref) => fragmentBBox(ket[ref] as KetMolecule | undefined));

    // Choose the target fragment index.
    let targetIndex = molRefs.length - 1;
    if (matchHeavyAtoms !== undefined) {
      const matched = molRefs.findIndex(
        (ref) => (ket[ref] as KetMolecule | undefined)?.atoms?.length === matchHeavyAtoms,
      );
      if (matched !== -1) targetIndex = matched;
    }

    const targetBBox = bboxes[targetIndex];
    if (!targetBBox) return; // no positioned target fragment

    // Drop every existing caption that belongs to the target fragment.
    ket.root.nodes = ket.root.nodes.filter((n) => {
      if (n.type !== "text") return true;
      const pos = (n.data as { position?: { x: number; y: number } } | undefined)?.position;
      if (!pos) return true;
      return nearestFragmentIndex(pos, bboxes) !== targetIndex;
    });

    // Add the single consolidated block, centered just below the target.
    if (lines.length > 0) {
      const centerX = captionAnchorX(targetBBox.minX, targetBBox.maxX, lines);
      const belowY = targetBBox.minY - 1.5;
      ket.root.nodes.push(makeMultilineTextNode(lines, centerX, belowY));
    }

    await ketcher.setMolecule(JSON.stringify(ket));
  });
}

/**
 * Add a SMILES fragment to the canvas WITHOUT wiping existing content. If
 * `label` is given, a caption with that text is placed below the new fragment.
 *
 * Calls are serialised globally so concurrent adds queue rather than race.
 *
 * @throws if the editor isn't ready.
 */
export function appendSmilesToCanvas(
  smiles: string,
  label?: string,
  ketcher: MinimalKetcher | undefined = currentKetcher(),
): Promise<void> {
  // Display names capitalised (PubChem returns lowercase, e.g. "aspirin").
  const display = label ? capitalizeFirst(label) : label;
  const run = async (): Promise<void> => {
    if (!ketcher) throw new Error("Editor not ready");
    if (display) registerName(smiles, display); // remember name for the panel
    await ketcher.addFragment(smiles);
    if (display) {
      const ket = JSON.parse(await ketcher.getKet()) as KetDoc;
      addCaptionToLastFragment(ket, display);
      await ketcher.setMolecule(JSON.stringify(ket));
    }
  };
  const result = chain.then(run, run);
  // Keep the chain alive regardless of whether this call succeeded.
  chain = result.catch(() => undefined);
  return result;
}
