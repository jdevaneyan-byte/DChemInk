import type { Ketcher } from "ketcher-core";
import { getHoveredAtomId } from "./hoverState";

interface SelectionShape {
  atoms?: number[];
  bonds?: number[];
}

/**
 * Returns the atom index that hotkeys should target — either:
 *
 *  1. The single atom in `editor.selection()` if exactly one is selected; or
 *  2. The atom currently under the cursor (`hoverState.hoveredAtomId`).
 *
 * The UX: you can either click an atom to select it OR
 * just hover and press a key. Without #2, a user pressing `2` over an atom
 * (which Ketcher highlights with a green hover ring) would silently get the
 * disconnected-fragment fallback.
 *
 * Returns `null` if no atom is selected and the cursor isn't over one.
 */
export function getActiveAtomIndex(ketcher: Ketcher | undefined): number | null {
  if (!ketcher) return null;
  const editor = (
    ketcher as unknown as {
      editor?: { selection?: () => SelectionShape | null };
    }
  ).editor;
  const sel = editor?.selection?.();
  if (sel?.atoms && sel.atoms.length === 1) return sel.atoms[0];
  return getHoveredAtomId();
}

/** Wrap `ketcher.setMolecule` so we can await + error-handle uniformly. */
export async function setMoleculeSafely(
  ketcher: Ketcher,
  input: string,
): Promise<void> {
  try {
    await ketcher.setMolecule(input);
  } catch (err) {
    console.error("[hotkeys] setMolecule failed", { input, err });
    throw err;
  }
}

/** Get the current canvas as a SMILES string, or empty string on failure. */
export async function getSmilesSafely(ketcher: Ketcher): Promise<string> {
  try {
    return await ketcher.getSmiles();
  } catch (err) {
    console.error("[hotkeys] getSmiles failed", err);
    return "";
  }
}

/**
 * Toggle Ketcher's "show atom numbers" display (the `showAtomIds` render
 * option). Bound to the ATOMNUMBER hotkey (`'`).
 */
export function toggleAtomNumbers(ketcher: Ketcher | undefined): void {
  const editor = (
    ketcher as unknown as {
      editor?: {
        options?: (opts?: Record<string, unknown>) => void;
        render?: { options?: { showAtomIds?: boolean } };
      };
    }
  ).editor;
  if (!editor?.options) return;
  const current = editor.render?.options?.showAtomIds ?? false;
  editor.options({ showAtomIds: !current });
}

/**
 * Select the atom currently under the cursor (hover). Bound to the SELECT
 * hotkey (`g`). No-op if nothing is hovered.
 */
export function selectActiveAtom(ketcher: Ketcher | undefined): void {
  if (!ketcher) return;
  const atomId = getActiveAtomIndex(ketcher);
  if (atomId === null) return;
  const editor = (
    ketcher as unknown as {
      editor?: { selection?: (sel: { atoms: number[]; bonds?: number[] }) => void };
    }
  ).editor;
  editor?.selection?.({ atoms: [atomId], bonds: [] });
  refreshRotateController(editor);
}

/**
 * Recompute the rotate controller's pivot after a *programmatic* selection.
 *
 * Ketcher updates the rotate handle's centre during real mouse selection, but
 * calling `editor.selection()` from code leaves `rotateController` with its
 * pivot at the origin (0,0), so its reference lines fan out from the canvas
 * corner. `rerender()` recomputes the pivot from the current selection.
 */
function refreshRotateController(editor: unknown): void {
  const rc = (editor as { rotateController?: { rerender?: () => void } } | undefined)
    ?.rotateController;
  try {
    rc?.rerender?.();
  } catch {
    // Non-fatal: older Ketcher builds may not expose rotateController.rerender.
  }
}

interface SelectStructAtom {
  fragment?: number;
}
interface SelectStructBond {
  begin: number;
  end: number;
}
interface StructForSelect {
  atoms: { forEach: (cb: (a: SelectStructAtom, id: number) => void) => void };
  bonds: { forEach: (cb: (b: SelectStructBond, id: number) => void) => void };
}

/**
 * Select the most-recently-drawn molecule on the canvas — the fragment that
 * contains the newest atom (highest atom id) — and switch the active tool to
 * "select" so the next drag *moves* that fragment instead of drawing. Bound
 * to the Space key. No-op on an empty canvas.
 *
 * We pick the fragment of the highest atom id because Ketcher assigns atom
 * ids monotonically, so the last atoms you add always have the largest ids.
 * Selecting only that fragment lets you reposition the thing you just drew
 * without grabbing the rest of the canvas.
 *
 * Without the `tool('select')` switch, pressing Space right after drawing
 * (when a ring/bond/template tool is still active) selects but a drag would
 * keep drawing. Activating the select tool turns the cursor into the
 * move/drag tool Ketcher uses for repositioning a selection.
 */
export function selectAllStructure(ketcher: Ketcher | undefined): void {
  if (!ketcher) return;
  const editor = (
    ketcher as unknown as {
      editor?: {
        struct?: () => StructForSelect;
        selection?: (sel: { atoms: number[]; bonds: number[] }) => void;
        tool?: (name: string, opts?: unknown) => unknown;
      };
    }
  ).editor;
  const struct = editor?.struct?.();
  if (!struct || !editor?.selection) return;

  // Find the fragment id of the highest atom id (the most recent atom), and
  // remember every atom's fragment so we can collect the whole fragment.
  const fragOfAtom = new Map<number, number | undefined>();
  let newestAtomId = -1;
  let targetFrag: number | undefined;
  struct.atoms.forEach((atom, id) => {
    fragOfAtom.set(id, atom.fragment);
    if (id > newestAtomId) {
      newestAtomId = id;
      targetFrag = atom.fragment;
    }
  });
  if (newestAtomId === -1) return; // empty canvas

  // Collect the target fragment's atoms (fall back to the single newest atom
  // if fragment ids are missing, e.g. a lone atom with no fragment).
  const atoms: number[] = [];
  const atomSet = new Set<number>();
  fragOfAtom.forEach((frag, id) => {
    if (frag === targetFrag) {
      atoms.push(id);
      atomSet.add(id);
    }
  });
  if (atoms.length === 0) {
    atoms.push(newestAtomId);
    atomSet.add(newestAtomId);
  }

  // A bond belongs to the fragment when both its atoms do.
  const bonds: number[] = [];
  struct.bonds.forEach((bond, id) => {
    if (atomSet.has(bond.begin) && atomSet.has(bond.end)) bonds.push(id);
  });

  // Cancel whatever draw tool is active and switch to the selection/move
  // tool. We dispatch a native Escape (Ketcher's own "back to selection"
  // binding) at its key listener so its toolbar state updates too — calling
  // editor.tool('select') directly leaves the React toolbar still armed with
  // the template, so the next click would keep drawing (the "press Space
  // twice" bug). `editor.tool('select')` remains as a fallback.
  if (!dispatchKetcherEscape()) editor.tool?.("select");

  // Apply selection last so the tool switch can't clear the highlight.
  editor.selection({ atoms, bonds });
  // Recompute the rotate pivot, else its reference lines fan from (0,0).
  refreshRotateController(editor);
}

/**
 * Send a native Escape keydown to Ketcher's internal key listener (bound to
 * its root element, which the cliparea textarea bubbles up to). Ketcher maps
 * Escape to "switch to the selection tool" and routes it through its own
 * action store, keeping the toolbar UI in sync. Returns false if no Ketcher
 * element could be found to dispatch on.
 */
function dispatchKetcherEscape(): boolean {
  const target =
    document.querySelector<HTMLElement>('[class*="cliparea"]') ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (!target) return false;
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}
