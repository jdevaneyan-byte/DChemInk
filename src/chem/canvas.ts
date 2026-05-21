/**
 * Canvas append helpers shared by the Name→structure box and the paste-a-name
 * handler, so both ADD a structure (never wipe the canvas) and caption it with
 * its name.
 *
 * Captions are bound to the molecule as **Data S-groups** (not loose text
 * objects). A Data S-group lives INSIDE a molecule node (`molNode.sgroups`),
 * binds to that molecule's atoms, renders a visible label, and moves / rotates /
 * flips WITH the molecule — surviving every edit. Because the caption is part of
 * the molecule (not a separate canvas object), rotating a captioned molecule can
 * never involve a loose text object, which was the source of the white-screen
 * rotate crash.
 *
 * We add via Ketcher's `addFragment` (which keeps existing molecules), then read
 * the KET back, push a Data S-group onto the relevant molecule node, and re-set
 * the whole KET. Ketcher strips custom molecule/atom fields but PRESERVES
 * sgroups.
 */

import { registerName } from "./nameRegistry";
import { fragmentBBox } from "./ketGeom";

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
/** A Data ("DAT") S-group bound to atoms of its containing molecule node. */
export interface KetSgroup {
  type: string; // "DAT"
  atoms: number[]; // atom indices WITHIN this molecule node (0-based)
  fieldName?: string;
  fieldData?: string;
  [key: string]: unknown;
}
export interface KetMolecule {
  atoms?: KetAtom[];
  sgroups?: KetSgroup[];
  stereoFlagPosition?: { x: number; y: number; z: number };
}
export interface KetDoc {
  root: { nodes: KetNode[] };
  [key: string]: unknown;
}

/** Field name used for caption Data S-groups, so we can find/replace our own. */
export const CAPTION_FIELD = "Name";

/**
 * Build a Data S-group that binds a `text` label to every atom of a molecule
 * with `atomCount` atoms (indices 0..atomCount-1, which are per-molecule-node).
 */
export function makeCaptionSgroup(text: string, atomCount: number): KetSgroup {
  return {
    type: "DAT",
    atoms: Array.from({ length: atomCount }, (_, i) => i),
    fieldName: CAPTION_FIELD,
    fieldData: text,
  };
}

/**
 * Combine caption lines into a single legible S-group label. A Data S-group's
 * `fieldData` collapses `\n` (renders as one line), and multiple single-line
 * S-groups all render at the same anchor (overlapping). So for v1 we join the
 * lines with " · " into ONE bound S-group — prioritising "bound + no crash"
 * over true multi-line, per the migration plan.
 */
export function joinCaptionLines(lines: string[]): string {
  return lines.filter((l) => l.length > 0).join(" · ");
}

/**
 * Drop every caption Data S-group (fieldName === CAPTION_FIELD) from a molecule
 * node, leaving any other (chemistry) S-groups intact. Returns the molecule.
 */
function removeCaptionSgroups(mol: KetMolecule | undefined): void {
  if (!mol?.sgroups) return;
  mol.sgroups = mol.sgroups.filter(
    (sg) => !(sg.type === "DAT" && sg.fieldName === CAPTION_FIELD),
  );
}

/** Push a caption S-group onto a molecule node (creating its sgroups array). */
function addCaptionSgroup(mol: KetMolecule, text: string): void {
  const count = mol.atoms?.length ?? 0;
  if (count === 0) return;
  (mol.sgroups ??= []).push(makeCaptionSgroup(text, count));
}

/** True if a molecule node already carries a caption Data S-group. */
function hasCaptionSgroup(mol: KetMolecule | undefined): boolean {
  return (mol?.sgroups ?? []).some(
    (sg) => sg.type === "DAT" && sg.fieldName === CAPTION_FIELD,
  );
}

/** Refs of all molecule (`$ref`) nodes in document order. */
function moleculeRefs(ket: KetDoc): string[] {
  return ket.root.nodes
    .filter((n) => typeof n.$ref === "string")
    .map((n) => n.$ref as string);
}

/**
 * Position signature of a fragment — its atom locations rounded and joined.
 * Used to spot the JUST-ADDED fragment after `addFragment` (its signature won't
 * match any pre-existing fragment). `addFragment` leaves existing fragments'
 * coordinates in place, so this reliably distinguishes even identical molecules
 * (they sit at different positions).
 */
function fragmentSignature(mol: KetMolecule | undefined): string {
  return (mol?.atoms ?? [])
    .map((a) =>
      a.location ? `${a.location[0].toFixed(2)},${a.location[1].toFixed(2)}` : "?",
    )
    .join("|");
}

export function currentKetcher(): MinimalKetcher | undefined {
  return (window as unknown as { ketcher?: MinimalKetcher }).ketcher;
}

/** Capitalise the first letter (rest untouched): "aspirin" → "Aspirin". */
export function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
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
 * Replace a molecule's caption with ONE consolidated, bound Data S-group.
 *
 * Used by "Paste to canvas": the molecule already carries its name caption
 * S-group, so we REMOVE every existing caption S-group on the target molecule
 * and push a single new one (name title + chosen property rows, joined into one
 * legible line — see `joinCaptionLines`). Because the S-group is bound to the
 * molecule's atoms it moves / rotates / flips with the molecule and never
 * detaches or jumps to a neighbour.
 *
 * Target molecule: the fragment whose `atoms.length === matchHeavyAtoms` if
 * given, else the LAST molecule fragment.
 *
 * Serialised on the shared canvas-write chain so it doesn't race other writes.
 * No-op if there is no editor or no target fragment. If `lines` is empty the
 * old caption S-group(s) are still removed (no replacement is added).
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

    // Choose the target fragment.
    let targetRef = molRefs[molRefs.length - 1];
    if (matchHeavyAtoms !== undefined) {
      const matched = molRefs.find(
        (ref) => (ket[ref] as KetMolecule | undefined)?.atoms?.length === matchHeavyAtoms,
      );
      if (matched) targetRef = matched;
    }

    const mol = ket[targetRef] as KetMolecule | undefined;
    if (!mol || fragmentBBox(mol) === null) return; // no positioned target

    // Replace this molecule's caption S-group(s) so re-pasting never stacks.
    removeCaptionSgroups(mol);
    const text = joinCaptionLines(lines);
    if (text.length > 0) addCaptionSgroup(mol, text);

    await ketcher.setMolecule(JSON.stringify(ket));
  });
}

/**
 * Add a SMILES fragment to the canvas WITHOUT wiping existing content. If
 * `label` is given, a caption Data S-group with that text is bound to the new
 * fragment (so it moves/rotates/flips with the molecule).
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

    // Snapshot existing fragments BEFORE adding, so we can identify the
    // newly-added one afterwards. The new fragment is NOT reliably the last
    // molecule node — Ketcher orders nodes by position, so adding a 2nd
    // identical molecule can leave the OLD one last (which caused the caption
    // to land on the wrong molecule: one with two names, the other with none).
    const preSigs = new Set<string>();
    if (display) {
      const preKet = JSON.parse(await ketcher.getKet()) as KetDoc;
      for (const ref of moleculeRefs(preKet)) {
        preSigs.add(fragmentSignature(preKet[ref] as KetMolecule));
      }
    }

    await ketcher.addFragment(smiles);

    if (display) {
      const ket = JSON.parse(await ketcher.getKet()) as KetDoc;
      const refs = moleculeRefs(ket);
      // Target = the fragment whose atom-position signature is new; else the
      // first node lacking a caption S-group; else the last node.
      const targetRef =
        refs.find((r) => !preSigs.has(fragmentSignature(ket[r] as KetMolecule))) ??
        refs.find((r) => !hasCaptionSgroup(ket[r] as KetMolecule)) ??
        refs[refs.length - 1];
      const mol = targetRef ? (ket[targetRef] as KetMolecule | undefined) : undefined;
      if (mol && (mol.atoms?.length ?? 0) > 0) {
        addCaptionSgroup(mol, display);
        await ketcher.setMolecule(JSON.stringify(ket));
      }
    }
  };
  const result = chain.then(run, run);
  // Keep the chain alive regardless of whether this call succeeded.
  chain = result.catch(() => undefined);
  return result;
}
