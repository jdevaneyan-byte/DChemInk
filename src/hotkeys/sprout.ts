import type { Ketcher } from "ketcher-core";
import { getActiveAtomIndex, getSmilesSafely, setMoleculeSafely } from "./ketcherBridge";
import {
  FRAGMENT_DEFS,
  emitV3000FromStruct,
  insertBondedSproutInV3000,
  changeAtomChargeInV3000,
} from "./sproutMol";

/**
 * Mapping from our SPROUT `value` codes to the canonical SMILES of the
 * substructure they insert.
 */
export const SPROUT_CODE_TO_SMILES: Record<string, string> = {
  "2": "C=O", // carbonyl
  "3": "c1ccccc1", // benzene
  "6": "C1CCCCC1", // cyclohexane
  "7": "C1CCCC1", // cyclopentane
  J: "c1ccccc1", // phenyl (alias)
};

// ---------------------------------------------------------------------------
// "No selection / empty canvas" path: just place / append-as-fragment.
// ---------------------------------------------------------------------------

/**
 * Append the substructure for `code` to `currentSmiles` as a SEPARATE
 * fragment (joined with ".") or return it alone if the canvas is empty.
 * Used when no atom is selected.
 */
export function appendSprout(currentSmiles: string, code: string): string | null {
  const fragment = SPROUT_CODE_TO_SMILES[code];
  if (!fragment) return null;
  const trimmed = currentSmiles.trim();
  if (trimmed === "") return fragment;
  return `${trimmed}.${fragment}`;
}

// ---------------------------------------------------------------------------
// Bonded sprout: insert the substructure as a SMILES branch on the active
// atom, so the new fragment is actually bonded to the user's selection.
// ---------------------------------------------------------------------------

/**
 * Insert `fragmentSmiles` as a branch `(fragment)` immediately after atom
 * `atomIdx` in `parentSmiles`. Returns the new SMILES, or `null` if the
 * atom index is out of range.
 *
 * Branches inserted this way default to a single bond between the active
 * atom and the first atom of the fragment, which is the expected SPROUT
 * behaviour for all five v0.2 substructures (carbonyl, benzene, cyclohexane,
 * cyclopentane, phenyl).
 */
export function insertBondedSprout(
  parentSmiles: string,
  atomIdx: number,
  fragmentSmiles: string,
): string | null {
  const pos = findAtomEndPosition(parentSmiles, atomIdx);
  if (pos === -1) return null;
  return parentSmiles.slice(0, pos) + `(${fragmentSmiles})` + parentSmiles.slice(pos);
}

/**
 * Walk a SMILES string and return the character index where `atomIdx` ends —
 * i.e. the position right *after* atom `atomIdx` and any ring-closure digits
 * attached to it. A branch inserted at this position becomes a substituent
 * on that atom.
 *
 * Returns `-1` if `atomIdx` is out of range.
 *
 * Recognised tokens:
 *   - organic-subset element letters (B, C, N, O, P, S, F, Cl, Br, I, H) and
 *     their aromatic-lowercase forms (b, c, n, o, p, s)
 *   - bracketed atoms `[...]`
 *   - ring-closure digits after an atom (`C1`, `c%12`)
 *   - bonds, branch parens, dots — skipped without counting as atoms
 */
export function findAtomEndPosition(smiles: string, atomIdx: number): number {
  let atomCount = 0;
  let i = 0;
  while (i < smiles.length) {
    const ch = smiles[i];

    if (ch === "[") {
      const end = smiles.indexOf("]", i);
      if (end === -1) return -1; // malformed
      const isOurs = atomCount === atomIdx;
      let nextPos = end + 1;
      if (isOurs) {
        nextPos = skipRingClosures(smiles, nextPos);
        return nextPos;
      }
      atomCount++;
      i = end + 1;
      continue;
    }

    if (isOrganicAtomChar(ch)) {
      const len = isTwoLetterElement(ch, smiles[i + 1]) ? 2 : 1;
      const isOurs = atomCount === atomIdx;
      let nextPos = i + len;
      if (isOurs) {
        nextPos = skipRingClosures(smiles, nextPos);
        return nextPos;
      }
      atomCount++;
      i += len;
      continue;
    }

    // Anything else (bond chars, '(', ')', '.', stray digits between atoms) — skip.
    i++;
  }
  return -1;
}

function isOrganicAtomChar(ch: string): boolean {
  // Uppercase organic-subset: B C N O P S F I H (Cl Br handled via the 2-letter check)
  // Lowercase aromatic:       b c n o p s
  return /[BCNOPSFIHbcnops]/.test(ch);
}

function isTwoLetterElement(ch1: string, ch2: string | undefined): boolean {
  if (!ch2) return false;
  return (ch1 === "C" && ch2 === "l") || (ch1 === "B" && ch2 === "r");
}

/** Advance past ring-closure tokens like `1`, `%12` that anchor to the atom. */
function skipRingClosures(smiles: string, pos: number): number {
  while (pos < smiles.length) {
    const c = smiles[pos];
    if (c === "%" && pos + 2 < smiles.length) {
      pos += 3;
    } else if (c >= "0" && c <= "9") {
      pos += 1;
    } else {
      break;
    }
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

type StructForV3000 = {
  atoms: { forEach: (cb: (a: { label: string; pp: { x: number; y: number } }, id: number) => void) => void };
  bonds: { forEach: (cb: (b: { begin: number; end: number; type: number }, id: number) => void) => void };
};

function getStruct(ketcher: Ketcher): StructForV3000 | null {
  const editor = (
    ketcher as unknown as { editor?: { struct?: () => StructForV3000 } }
  ).editor;
  return editor?.struct?.() ?? null;
}

/**
 * Bond `fragmentDef` to atom `atomIdx` (Ketcher struct ID) via V3000
 * manipulation. Returns true if it set a new molecule, false otherwise.
 * `fallbackSmiles` (if provided) is used when V3000 emission fails.
 */
async function bondFragmentToAtom(
  ketcher: Ketcher,
  atomIdx: number,
  fragmentDef: (typeof FRAGMENT_DEFS)[string],
  fallbackSmiles: string | null,
  currentSmiles: string,
): Promise<boolean> {
  const struct = getStruct(ketcher);
  const emitted = struct ? emitV3000FromStruct(struct) : null;
  // Struct IDs can have gaps from edits; translate to the 1-based V3000 row.
  const v3000Pos = emitted?.idToPos.get(atomIdx);
  const updated =
    emitted && v3000Pos !== undefined
      ? insertBondedSproutInV3000(emitted.mol, v3000Pos - 1, fragmentDef)
      : null;
  if (updated) {
    await setMoleculeSafely(ketcher, updated);
    return true;
  }
  // Fall back to SMILES-string insertion if available.
  if (fallbackSmiles) {
    const fallback = insertBondedSprout(currentSmiles, atomIdx, fallbackSmiles);
    if (fallback !== null) {
      await setMoleculeSafely(ketcher, fallback);
      return true;
    }
  }
  return false;
}

/**
 * Run a SPROUT command. If an atom is selected or hovered, bond the
 * substructure to it via V3000-MOL manipulation (atom IDs are stable in
 * V3000). Otherwise, place the substructure on its own.
 */
export async function applySprout(
  ketcher: Ketcher,
  code: string,
): Promise<boolean> {
  const fragmentDef = FRAGMENT_DEFS[code];
  if (!fragmentDef) {
    console.info(`[hotkeys] SPROUT code '${code}' not implemented`);
    return false;
  }
  const atomIdx = getActiveAtomIndex(ketcher);
  const currentSmiles = await getSmilesSafely(ketcher);

  // Empty canvas or no selection/hover → place the fragment alone.
  if (currentSmiles.trim() === "" || atomIdx === null) {
    const next = appendSprout(currentSmiles, code);
    if (next === null) return false;
    await setMoleculeSafely(ketcher, next);
    return true;
  }

  const bonded = await bondFragmentToAtom(
    ketcher,
    atomIdx,
    fragmentDef,
    SPROUT_CODE_TO_SMILES[code] ?? null,
    currentSmiles,
  );
  if (bonded) return true;

  // Final fallback: disconnected fragment.
  const next = appendSprout(currentSmiles, code);
  if (next === null) return false;
  await setMoleculeSafely(ketcher, next);
  return true;
}

/**
 * Oxidize the hovered/selected atom — add a double-bonded O directly to it.
 * Converts CH3 → CHO (benzaldehyde from toluene), CH2 → C=O (ketone /
 * acetophenone from ethylbenzene), S → S=O (sulfoxide), etc. Bound to `=`.
 *
 * Requires an active atom; there's no empty-canvas behaviour (you can't
 * oxidize nothing).
 */
export async function applyOxidize(ketcher: Ketcher): Promise<boolean> {
  const atomIdx = getActiveAtomIndex(ketcher);
  if (atomIdx === null) {
    console.info("[hotkeys] '=' (oxidize) requires a hovered/selected atom");
    return false;
  }
  const currentSmiles = await getSmilesSafely(ketcher);
  return bondFragmentToAtom(
    ketcher,
    atomIdx,
    FRAGMENT_DEFS.oxidize,
    null, // no SMILES fallback — V3000 path is required for a clean double bond
    currentSmiles,
  );
}

/**
 * Adjust the formal charge of the hovered/selected atom by `delta`
 * (+1 for the `+` key, -1 for `-`). Bound to the CHARGE hotkey.
 */
export async function applyCharge(
  ketcher: Ketcher,
  delta: number,
): Promise<boolean> {
  const atomIdx = getActiveAtomIndex(ketcher);
  if (atomIdx === null) {
    console.info("[hotkeys] charge change requires a hovered/selected atom");
    return false;
  }
  const struct = getStruct(ketcher);
  const emitted = struct ? emitV3000FromStruct(struct) : null;
  const v3000Pos = emitted?.idToPos.get(atomIdx);
  if (!emitted || v3000Pos === undefined) return false;
  const updated = changeAtomChargeInV3000(emitted.mol, v3000Pos - 1, delta);
  if (!updated) return false;
  await setMoleculeSafely(ketcher, updated);
  return true;
}
