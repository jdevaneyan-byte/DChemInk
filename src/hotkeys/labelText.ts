import type { Ketcher } from "ketcher-core";
import { getActiveAtomIndex, setMoleculeSafely } from "./ketcherBridge";
import { emitV3000FromStruct } from "./sproutMol";

/**
 * Element-symbol labels — pressing `s`/`n`/`o`/etc. changes the hovered
 * atom's ELEMENT in Ketcher's struct. Ketcher then re-renders with the
 * correct implicit-H count (terminal S → "SH", terminal Si → "SiH3", etc).
 * These take a different code path than the alias labels below: we mutate
 * the V3000 atom symbol field directly instead of attaching a CXSMILES
 * alias (which would leave the element as C and only change the display).
 */
export const ELEMENT_LABELS = new Set([
  "H",
  "B",
  "C",
  "N",
  "O",
  "F",
  "P",
  "S",
  "Cl",
  "Br",
  "I",
  "Si",
  "Li",
  "D", // deuterium — Ketcher treats it specially but accepts as a "D" symbol
]);

/**
 * Multi-character labels that are pseudo-groups (Me, Et, Ph, Boc, Tos, …).
 * These get attached as CXSMILES aliases; the underlying atom stays as
 * whatever it was, and Ketcher renders the custom text.
 */
export const SUPPORTED_LABELS = new Set([
  "Me",
  "Et",
  "Ph",
  "Bn",
  "Ac",
  "Bz",
  "Tos",
  "Boc",
  "Fmoc",
  "Cbz",
  "CF3",
  "NO2",
  "CN",
  "OMe",
  "OH",
  "NH2",
  "CO2Me",
  "MgBr",
  "N3",
  "R", // R-group / generic substituent label
  "X", // halogen / generic query label
]);

/**
 * Top-level entry: read the current canvas as a MOL, attach an A (atom
 * alias) record to the selected atom so it displays as `label`, and write
 * the new MOL back.
 *
 * No-ops with a console hint if (a) no atom is selected or (b) more than
 * one atom is selected. Returns `true` if the canvas changed.
 */
export async function applyLabel(
  ketcher: Ketcher,
  label: string,
): Promise<boolean> {
  const atomIdx = getActiveAtomIndex(ketcher);
  if (atomIdx === null) {
    console.info("[hotkeys] LABELTEXT requires exactly one hovered/selected atom");
    return false;
  }

  // Element change path: mutate V3000 atom symbol directly so Ketcher knows
  // the atom is a different element (and renders its implicit-H count
  // accordingly). E.g. `s` on a CH3 becomes SH visually.
  if (ELEMENT_LABELS.has(label)) {
    return applyElementChange(ketcher, atomIdx, label);
  }

  // Alias path: CXSMILES `|$labels$|` attaches a custom display label without
  // changing the underlying atom (which stays a carbon for groups like Me).
  if (SUPPORTED_LABELS.has(label)) {
    const smiles = await ketcher.getSmiles();
    const totalAtoms = countAtoms(ketcher);
    if (totalAtoms === null) return false;
    const cxsmiles = buildLabeledCxsmiles(smiles, atomIdx, label, totalAtoms);
    await setMoleculeSafely(ketcher, cxsmiles);
    return true;
  }

  console.info(`[hotkeys] label '${label}' not in v0.3 support set; skipping`);
  return false;
}

async function applyElementChange(
  ketcher: Ketcher,
  atomIdx: number,
  element: string,
): Promise<boolean> {
  const editor = (
    ketcher as unknown as {
      editor?: {
        struct?: () => {
          atoms: { forEach: (cb: (a: { label: string; pp: { x: number; y: number } }, id: number) => void) => void };
          bonds: { forEach: (cb: (b: { begin: number; end: number; type: number }, id: number) => void) => void };
        };
      };
    }
  ).editor;
  const struct = editor?.struct?.();
  if (!struct) return false;
  const { mol, idToPos } = emitV3000FromStruct(struct);
  const v3000Pos = idToPos.get(atomIdx);
  if (v3000Pos === undefined) return false;
  const updated = changeAtomElementInV3000(mol, v3000Pos - 1, element);
  if (!updated) return false;
  console.info(
    `[label] element-change atom ${atomIdx} → '${element}' (v3000 row ${v3000Pos})`,
  );
  await setMoleculeSafely(ketcher, updated);
  return true;
}

/**
 * Replace the element symbol of atom at row `atomIdx` (0-based) in a V3000
 * MOL with `newElement`. V3000 atom line:
 *   `M  V30 <idx> <element> <x> <y> <z> <charge>`
 */
export function changeAtomElementInV3000(
  mol: string,
  atomIdx: number,
  newElement: string,
): string | null {
  const lines = mol.split("\n");
  const beginAtom = lines.findIndex((l) => /M\s+V30\s+BEGIN\s+ATOM/i.test(l));
  const endAtom = lines.findIndex((l) => /M\s+V30\s+END\s+ATOM/i.test(l));
  if (beginAtom < 0 || endAtom < 0) return null;
  const lineIdx = beginAtom + 1 + atomIdx;
  if (lineIdx >= endAtom) return null;
  const original = lines[lineIdx];
  // Replace the 4th whitespace-separated token (the element symbol).
  // Tokens: M V30 <idx> <element> <x> <y> ...
  lines[lineIdx] = original.replace(
    /^(\s*M\s+V30\s+\d+\s+)(\S+)/,
    (_full, prefix) => `${prefix}${newElement}`,
  );
  return lines.join("\n");
}

/** Count atoms in the current canvas via Ketcher's struct, or null on failure. */
function countAtoms(ketcher: Ketcher): number | null {
  const editor = (
    ketcher as unknown as {
      editor?: { struct?: () => { atoms?: { size: number } } };
    }
  ).editor;
  const size = editor?.struct?.()?.atoms?.size;
  return typeof size === "number" ? size : null;
}

/**
 * Build a CXSMILES string with `label` attached to atom at `atomIdx`.
 * Format: `<smiles> |$l0;l1;...$|` — semicolon-separated labels in atom
 * order. Empty entries leave the atom unlabeled.
 *
 * Example: `buildLabeledCxsmiles("CC", 0, "Me", 2)` → `"CC |$Me;$|"`.
 */
export function buildLabeledCxsmiles(
  smiles: string,
  atomIdx: number,
  label: string,
  totalAtoms: number,
): string {
  if (atomIdx < 0 || atomIdx >= totalAtoms) {
    throw new Error(
      `atom index ${atomIdx} out of range (have ${totalAtoms} atoms)`,
    );
  }
  const labels = new Array(totalAtoms).fill("");
  labels[atomIdx] = label;
  return `${smiles.trim()} |$${labels.join(";")}$|`;
}

/**
 * Pure function: given a MOL V2000 string, attach an A (atom alias) record
 * to `atomIdx` (0-based) so Ketcher renders the atom as `label`.
 *
 * The A record is two lines inserted just before `M  END`:
 *
 *     A    <aaa>
 *     <label>
 *
 * where `aaa` is the 1-based atom number, right-justified in a 3-char field.
 *
 * This is the MDL-spec way to give an atom a custom display label without
 * fighting the 3-char element-symbol limit in the atom block.
 *
 * Throws if `atomIdx` is out of range.
 */
export function applyLabelToMolfile(
  mol: string,
  atomIdx: number,
  label: string,
): string {
  const lines = mol.split("\n");
  const countsLineIdx = lines.findIndex((l) => /V2000\s*$/.test(l));
  if (countsLineIdx === -1) {
    throw new Error("not a MOL V2000 file (no counts line)");
  }
  const nAtoms = Number(lines[countsLineIdx].slice(0, 3).trim());
  if (atomIdx < 0 || atomIdx >= nAtoms) {
    throw new Error(`atom index ${atomIdx} out of range (have ${nAtoms} atoms)`);
  }

  const endIdx = lines.findIndex((l) => /^M\s+END/.test(l));
  if (endIdx === -1) {
    throw new Error("not a MOL V2000 file (no M  END line)");
  }

  // 1-based atom number, right-justified in 3 chars (so 1 → "  1", 12 → " 12").
  const aaa = String(atomIdx + 1).padStart(3, " ");
  const aliasHeader = `A  ${aaa}`;
  const aliasBody = label;

  // Drop any existing A record targeting the same atom (so repeated labels
  // don't pile up). A records consume exactly two lines.
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("A  ") && line.includes(aaa.trim())) {
      // Only skip if it's clearly an alias for this atom; verify by checking
      // the atom number field exactly matches.
      const num = line.slice(3).trim();
      if (num === String(atomIdx + 1)) {
        i += 1; // skip the alias body too
        continue;
      }
    }
    filtered.push(line);
  }

  const newEndIdx = filtered.findIndex((l) => /^M\s+END/.test(l));
  filtered.splice(newEndIdx, 0, aliasHeader, aliasBody);
  return filtered.join("\n");
}
