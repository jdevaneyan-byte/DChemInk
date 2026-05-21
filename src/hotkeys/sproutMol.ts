/**
 * Build a V3000 MOL ourselves from Ketcher's `editor.struct()` so atom row
 * order matches Ketcher's internal atom IDs exactly. Avoids
 * `ketcher.getMolfile('v3000')` because that goes through Indigo's
 * Auto-format heuristics and may return SMILES for small structures —
 * losing the stable atom ordering we need.
 */
interface StructAtom {
  label: string;
  pp: { x: number; y: number };
  charge?: number;
}
interface StructBond {
  begin: number;
  end: number;
  type: number; // 1=single, 2=double, 3=triple, 4=aromatic
}
interface StructLike {
  atoms: {
    forEach: (cb: (atom: StructAtom, id: number) => void) => void;
  };
  bonds: {
    forEach: (cb: (bond: StructBond, id: number) => void) => void;
  };
}

export function emitV3000FromStruct(struct: StructLike): {
  mol: string;
  atomCoords: { id: number; x: number; y: number }[];
  /** Map from Ketcher struct atom ID → 1-based V3000 row. Struct IDs are
   *  monotonically increasing and may have gaps from deleted atoms, so this
   *  translation is required for any caller that wants to refer to a
   *  specific atom by its struct ID. */
  idToPos: Map<number, number>;
} {
  const atomLines: string[] = [];
  const atomCoords: { id: number; x: number; y: number }[] = [];
  const idToPos = new Map<number, number>();
  let pos = 1;
  struct.atoms.forEach((atom, id) => {
    idToPos.set(id, pos);
    atomCoords.push({ id, x: atom.pp.x, y: atom.pp.y });
    // V3000 charge is the CHG=<n> keyword prop, NOT the positional aamap
    // field (the trailing 0). Only emit it when nonzero.
    const chg = atom.charge && atom.charge !== 0 ? ` CHG=${atom.charge}` : "";
    atomLines.push(
      `M  V30 ${pos} ${atom.label} ${atom.pp.x.toFixed(4)} ${atom.pp.y.toFixed(4)} 0.0 0${chg}`,
    );
    pos++;
  });
  const bondLines: string[] = [];
  let bondPos = 1;
  struct.bonds.forEach((bond) => {
    const a1 = idToPos.get(bond.begin);
    const a2 = idToPos.get(bond.end);
    if (a1 == null || a2 == null) return;
    bondLines.push(`M  V30 ${bondPos} ${bond.type} ${a1} ${a2}`);
    bondPos++;
  });
  const mol = [
    "",
    "  DChemInk",
    "",
    "  0  0  0  0  0  0  0  0  0  0  0 V3000",
    "M  V30 BEGIN CTAB",
    `M  V30 COUNTS ${atomLines.length} ${bondLines.length} 0 0 0`,
    "M  V30 BEGIN ATOM",
    ...atomLines,
    "M  V30 END ATOM",
    "M  V30 BEGIN BOND",
    ...bondLines,
    "M  V30 END BOND",
    "M  V30 END CTAB",
    "M  END",
  ].join("\n");
  return { mol, atomCoords, idToPos };
}

/**
 * V3000-MOL based bonded SPROUT.
 *
 * Why MOL not SMILES: Ketcher's internal atom IDs (which `editor.findItem`
 * returns) match the atom row order in V3000 MOL output (1-based), but NOT
 * the position order in canonical SMILES — so a SMILES-string approach
 * targets the wrong atom whenever the user draws structures in a non-
 * canonical order (i.e. nearly always). V3000 is the stable layer.
 *
 * What this does NOT do (yet):
 *  - preserve 2D layout perfectly. Ketcher recomputes layout on setMolecule.
 *    We seed the new atoms near the active one but Ketcher may shift things.
 */

interface FragmentAtom {
  element: string;
  /** Offset relative to the active (anchor) atom position, in Ketcher's 2D units. */
  dx: number;
  dy: number;
}

interface FragmentBond {
  /** 1-based index into the fragment's atoms array. */
  a: number;
  b: number;
  /** V3000 bond type: 1=single, 2=double, 3=triple, 4=aromatic. */
  type: 1 | 2 | 3 | 4;
}

interface Fragment {
  atoms: FragmentAtom[];
  bonds: FragmentBond[];
  /**
   * Bond type for the new connection(s) between the active atom and the
   * fragment. Almost always a single bond.
   */
  connectingBondType: 1 | 2 | 3 | 4;
  /**
   * Which fragment atoms (1-based) bond to the active atom. Defaults to
   * `[1]`. Use multiple (e.g. `[1, 2]`) for geminal substituents like
   * gem-dimethyl, where two new atoms each attach to the same active atom.
   */
  connectingAtoms?: number[];
}

/**
 * Pre-built fragment definitions. Each fragment's atom #1 becomes the
 * attachment point to the user's selected atom. Coords are laid out with
 * 1.0-unit bond lengths to match Ketcher's defaults.
 */
export const FRAGMENT_DEFS: Record<string, Fragment> = {
  // 0 / 1: "add a bond" (cyclic / linear draw mode). We model
  // both as "extend the chain by one carbon" — a single C single-bonded to
  // the active atom.
  "0": {
    atoms: [{ element: "C", dx: 1.0, dy: 0.0 }],
    bonds: [],
    connectingBondType: 1,
  },
  "1": {
    atoms: [{ element: "C", dx: 1.0, dy: 0.0 }],
    bonds: [],
    connectingBondType: 1,
  },
  // 2: carbonyl C=O — atom 1 is the carbon (bonded to active atom). The
  // carbon is sp2, so the C=O sits ~120° off the incoming bond instead of
  // co-linear with it (which drew as a flat R—C—O line). O at (1.5, 0.866)
  // = 120° from the active→C direction.
  "2": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "O", dx: 1.5, dy: 0.866 },
    ],
    bonds: [{ a: 1, b: 2, type: 2 }],
    connectingBondType: 1,
  },
  // 3: benzene (aromatic 6-ring)
  "3": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.5, dy: 0.87 },
      { element: "C", dx: 2.5, dy: 0.87 },
      { element: "C", dx: 3.0, dy: 0.0 },
      { element: "C", dx: 2.5, dy: -0.87 },
      { element: "C", dx: 1.5, dy: -0.87 },
    ],
    bonds: [
      { a: 1, b: 2, type: 4 },
      { a: 2, b: 3, type: 4 },
      { a: 3, b: 4, type: 4 },
      { a: 4, b: 5, type: 4 },
      { a: 5, b: 6, type: 4 },
      { a: 6, b: 1, type: 4 },
    ],
    connectingBondType: 1,
  },
  // 6: cyclohexane
  "6": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.5, dy: 0.87 },
      { element: "C", dx: 2.5, dy: 0.87 },
      { element: "C", dx: 3.0, dy: 0.0 },
      { element: "C", dx: 2.5, dy: -0.87 },
      { element: "C", dx: 1.5, dy: -0.87 },
    ],
    bonds: [
      { a: 1, b: 2, type: 1 },
      { a: 2, b: 3, type: 1 },
      { a: 3, b: 4, type: 1 },
      { a: 4, b: 5, type: 1 },
      { a: 5, b: 6, type: 1 },
      { a: 6, b: 1, type: 1 },
    ],
    connectingBondType: 1,
  },
  // 7: cyclopentane
  "7": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.6, dy: 0.95 },
      { element: "C", dx: 2.55, dy: 0.59 },
      { element: "C", dx: 2.55, dy: -0.59 },
      { element: "C", dx: 1.6, dy: -0.95 },
    ],
    bonds: [
      { a: 1, b: 2, type: 1 },
      { a: 2, b: 3, type: 1 },
      { a: 3, b: 4, type: 1 },
      { a: 4, b: 5, type: 1 },
      { a: 5, b: 1, type: 1 },
    ],
    connectingBondType: 1,
  },
  // 8: methylidene =CH2 — a terminal carbon double-bonded to the active atom.
  "8": {
    atoms: [{ element: "C", dx: 1.0, dy: 0.0 }],
    bonds: [],
    connectingBondType: 2,
  },
  // 9: gem-dimethyl — two methyls on the same active atom (both single-bonded).
  "9": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.6 },
      { element: "C", dx: 1.0, dy: -0.6 },
    ],
    bonds: [],
    connectingBondType: 1,
    connectingAtoms: [1, 2],
  },
  // 10: alkyne —C≡C (linear, so co-linear coords are correct geometry).
  "10": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 2.0, dy: 0.0 },
    ],
    bonds: [{ a: 1, b: 2, type: 3 }],
    connectingBondType: 1,
  },
  // 11: cyclopropyl (3-ring)
  "11": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.87, dy: 0.5 },
      { element: "C", dx: 1.87, dy: -0.5 },
    ],
    bonds: [
      { a: 1, b: 2, type: 1 },
      { a: 2, b: 3, type: 1 },
      { a: 3, b: 1, type: 1 },
    ],
    connectingBondType: 1,
  },
  // 12: cyclobutane (4-ring)
  "12": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.71, dy: 0.71 },
      { element: "C", dx: 2.41, dy: 0.0 },
      { element: "C", dx: 1.71, dy: -0.71 },
    ],
    bonds: [
      { a: 1, b: 2, type: 1 },
      { a: 2, b: 3, type: 1 },
      { a: 3, b: 4, type: 1 },
      { a: 4, b: 1, type: 1 },
    ],
    connectingBondType: 1,
  },
  // 13: tert-butyl — central C with three methyls.
  "13": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 }, // central C (attaches to active)
      { element: "C", dx: 1.5, dy: 0.87 },
      { element: "C", dx: 1.5, dy: -0.87 },
      { element: "C", dx: 2.0, dy: 0.0 },
    ],
    bonds: [
      { a: 1, b: 2, type: 1 },
      { a: 1, b: 3, type: 1 },
      { a: 1, b: 4, type: 1 },
    ],
    connectingBondType: 1,
  },
  // 14: sulfonyl —S(=O)(=O)— (S with two double-bonded O).
  "14": {
    atoms: [
      { element: "S", dx: 1.0, dy: 0.0 },
      { element: "O", dx: 1.5, dy: 0.87 },
      { element: "O", dx: 1.5, dy: -0.87 },
    ],
    bonds: [
      { a: 1, b: 2, type: 2 },
      { a: 1, b: 3, type: 2 },
    ],
    connectingBondType: 1,
  },
  // 15: cyclopentadienyl (Cp) — 5-ring with two double bonds.
  "15": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.6, dy: 0.95 },
      { element: "C", dx: 2.55, dy: 0.59 },
      { element: "C", dx: 2.55, dy: -0.59 },
      { element: "C", dx: 1.6, dy: -0.95 },
    ],
    bonds: [
      { a: 1, b: 2, type: 2 },
      { a: 2, b: 3, type: 1 },
      { a: 3, b: 4, type: 2 },
      { a: 4, b: 5, type: 1 },
      { a: 5, b: 1, type: 1 },
    ],
    connectingBondType: 1,
  },
  // 16: phenyl — same hexagon as benzene; emitted by the `J` key
  // (it was previously mis-keyed as "J" and never dispatched).
  "16": {
    atoms: [
      { element: "C", dx: 1.0, dy: 0.0 },
      { element: "C", dx: 1.5, dy: 0.87 },
      { element: "C", dx: 2.5, dy: 0.87 },
      { element: "C", dx: 3.0, dy: 0.0 },
      { element: "C", dx: 2.5, dy: -0.87 },
      { element: "C", dx: 1.5, dy: -0.87 },
    ],
    bonds: [
      { a: 1, b: 2, type: 4 },
      { a: 2, b: 3, type: 4 },
      { a: 3, b: 4, type: 4 },
      { a: 4, b: 5, type: 4 },
      { a: 5, b: 6, type: 4 },
      { a: 6, b: 1, type: 4 },
    ],
    connectingBondType: 1,
  },
  // oxidize: bound to '=' in our tool. Adds a single
  // O double-bonded to the active atom — converting CH3→CHO (benzaldehyde),
  // CH2→C=O (ketone, e.g. acetophenone), S→S=O (sulfoxide), etc.
  oxidize: {
    atoms: [{ element: "O", dx: 1.0, dy: 0.0 }],
    bonds: [],
    connectingBondType: 2,
  },
};

/**
 * Increment (or decrement) the formal charge of atom at V3000 row `atomIdx`
 * (0-based) by `delta`. Manipulates the `CHG=<n>` keyword on that atom line:
 * adds it if absent, updates it if present, removes it when the result is 0.
 * Returns the new V3000 MOL, or null on parse failure / out-of-range index.
 */
export function changeAtomChargeInV3000(
  mol: string,
  atomIdx: number,
  delta: number,
): string | null {
  const lines = mol.split("\n");
  const beginAtom = lines.findIndex((l) => /M\s+V30\s+BEGIN\s+ATOM/i.test(l));
  const endAtom = lines.findIndex((l) => /M\s+V30\s+END\s+ATOM/i.test(l));
  if (beginAtom < 0 || endAtom < 0) return null;
  const lineIdx = beginAtom + 1 + atomIdx;
  if (lineIdx >= endAtom) return null;

  const line = lines[lineIdx];
  const chgMatch = line.match(/\bCHG=(-?\d+)\b/);
  const current = chgMatch ? Number(chgMatch[1]) : 0;
  const next = current + delta;

  let updated: string;
  if (chgMatch) {
    updated =
      next === 0
        ? line.replace(/\s*\bCHG=-?\d+\b/, "")
        : line.replace(/\bCHG=-?\d+\b/, `CHG=${next}`);
  } else {
    updated = next === 0 ? line : `${line.trimEnd()} CHG=${next}`;
  }
  lines[lineIdx] = updated;
  return lines.join("\n");
}

interface ParsedV3000 {
  /** Header lines, including counts placeholder, up to (but not including) "M  V30 BEGIN ATOM". */
  preamble: string;
  /** "M  V30 BEGIN ATOM" through "M  V30 END ATOM" inclusive, split into lines. */
  atomLines: string[]; // body lines (without BEGIN/END)
  bondLines: string[];
  /** Lines after "M  V30 END BOND" through "M  END". */
  trailer: string;
  nAtoms: number;
  nBonds: number;
  /** Coordinates of each atom (1-indexed). */
  atomCoords: { x: number; y: number }[];
}

/**
 * Parse a V3000 MOL file into editable pieces.
 * Returns null if the input isn't a recognisable V3000 file.
 */
export function parseV3000(mol: string): ParsedV3000 | null {
  const lines = mol.split(/\r?\n/);
  const beginAtom = lines.findIndex((l) => /M\s+V30\s+BEGIN\s+ATOM/i.test(l));
  const endAtom = lines.findIndex((l) => /M\s+V30\s+END\s+ATOM/i.test(l));
  const beginBond = lines.findIndex((l) => /M\s+V30\s+BEGIN\s+BOND/i.test(l));
  const endBond = lines.findIndex((l) => /M\s+V30\s+END\s+BOND/i.test(l));
  if (beginAtom < 0 || endAtom < 0 || beginBond < 0 || endBond < 0) return null;

  const atomLines = lines.slice(beginAtom + 1, endAtom);
  const bondLines = lines.slice(beginBond + 1, endBond);
  const preamble = lines.slice(0, beginAtom).join("\n");
  const trailer = lines.slice(endBond + 1).join("\n");

  // Each atom line: "M  V30 <idx> <element> <x> <y> <z> <charge>"
  const atomCoords: { x: number; y: number }[] = [];
  for (const line of atomLines) {
    const parts = line.trim().split(/\s+/);
    // tokens: M V30 idx element x y z charge ...
    if (parts.length < 7) {
      atomCoords.push({ x: 0, y: 0 });
      continue;
    }
    atomCoords.push({ x: Number(parts[4]), y: Number(parts[5]) });
  }

  return {
    preamble,
    atomLines,
    bondLines,
    trailer,
    nAtoms: atomLines.length,
    nBonds: bondLines.length,
    atomCoords,
  };
}

/**
 * Compute the angle (in radians) at which to extend a new bond from the
 * active atom, so the new substituent sits in the "least crowded" direction
 * — using a standard chain-angle / bisector heuristic.
 *
 * - 0 existing bonds: arbitrary (we pick right, angle = 0).
 * - 1 existing bond: place at ±120° from it (the "chain angle"). Picks the
 *   side that points upward (positive y in MOL coords) for readability.
 * - 2+ existing bonds: bisector of the largest angular gap.
 */
export function chooseNewBondAngle(
  activeX: number,
  activeY: number,
  neighborPositions: { x: number; y: number }[],
): number {
  if (neighborPositions.length === 0) return 0;
  const angles = neighborPositions.map((n) =>
    Math.atan2(n.y - activeY, n.x - activeX),
  );
  if (angles.length === 1) {
    const TWO_PI = 2 * Math.PI;
    const offset = (2 * Math.PI) / 3; // 120°
    const norm = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
    const up = norm(angles[0] + offset);
    const down = norm(angles[0] - offset);
    // MOL convention: y increases upward, so larger sin == higher on page.
    return Math.sin(up) >= Math.sin(down) ? up : down;
  }
  // Sort, find largest gap, return its bisector.
  const sorted = [...angles].sort((a, b) => a - b);
  let largestGap = -Infinity;
  let bisector = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b =
      i === sorted.length - 1 ? sorted[0] + 2 * Math.PI : sorted[i + 1];
    const gap = b - a;
    if (gap > largestGap) {
      largestGap = gap;
      bisector = a + gap / 2;
    }
  }
  return bisector;
}

/**
 * Insert `fragmentDef` into `parentMol` so that fragment atom 1 is bonded
 * to parent atom `atomIdx` (0-based). The fragment is rotated so that its
 * first atom sits in the least-crowded direction from the active atom
 * (~120° from any existing bond), so the result looks like a normal
 * chemistry drawing instead of all-new-atoms-going-straight-right.
 *
 * Returns the new V3000 MOL or null on parse failure / out-of-range atomIdx.
 */
export function insertBondedSproutInV3000(
  parentMol: string,
  atomIdx: number,
  fragmentDef: Fragment,
): string | null {
  const p = parseV3000(parentMol);
  if (!p) return null;
  if (atomIdx < 0 || atomIdx >= p.nAtoms) return null;

  const anchor = p.atomCoords[atomIdx];
  const baseIdx = p.nAtoms;

  // Collect positions of atoms bonded to the active atom (its neighbours).
  // Bond line format: "M  V30 <idx> <type> <a1> <a2>".
  const activeRow = atomIdx + 1;
  const neighbors: { x: number; y: number }[] = [];
  for (const bondLine of p.bondLines) {
    const tokens = bondLine.trim().split(/\s+/);
    if (tokens.length < 6) continue;
    const a1 = Number(tokens[4]);
    const a2 = Number(tokens[5]);
    const other = a1 === activeRow ? a2 : a2 === activeRow ? a1 : 0;
    if (other > 0 && other <= p.nAtoms) {
      neighbors.push(p.atomCoords[other - 1]);
    }
  }
  const angle = chooseNewBondAngle(anchor.x, anchor.y, neighbors);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const newAtomLines = fragmentDef.atoms.map((a, i) => {
    const idx = baseIdx + i + 1;
    // Rotate (a.dx, a.dy) by `angle` so the fragment's atom-1 lands at the
    // chosen direction (instead of always due right).
    const rdx = a.dx * cosA - a.dy * sinA;
    const rdy = a.dx * sinA + a.dy * cosA;
    const x = (anchor.x + rdx).toFixed(4);
    const y = (anchor.y + rdy).toFixed(4);
    return `M  V30 ${idx} ${a.element} ${x} ${y} 0.0 0`;
  });

  const baseBondIdx = p.nBonds;
  const newBondLines = fragmentDef.bonds.map((b, i) => {
    const bondIdx = baseBondIdx + i + 1;
    const a1 = baseIdx + b.a;
    const a2 = baseIdx + b.b;
    return `M  V30 ${bondIdx} ${b.type} ${a1} ${a2}`;
  });

  // Connecting bond(s): active atom (atomIdx+1) ↔ each fragment atom listed
  // in connectingAtoms (default [1]). Multiple connections support geminal
  // substituents (gem-dimethyl: two methyls on the same atom).
  const connectingAtoms = fragmentDef.connectingAtoms ?? [1];
  const connectingBonds = connectingAtoms.map((fragAtom, i) => {
    const bondIdx = baseBondIdx + newBondLines.length + i + 1;
    return `M  V30 ${bondIdx} ${fragmentDef.connectingBondType} ${atomIdx + 1} ${baseIdx + fragAtom}`;
  });

  const totalAtoms = p.nAtoms + fragmentDef.atoms.length;
  const totalBonds =
    p.nBonds + fragmentDef.bonds.length + connectingBonds.length;

  // Find and rewrite the COUNTS line inside preamble.
  const preambleLines = p.preamble.split("\n");
  const countsIdx = preambleLines.findIndex((l) => /M\s+V30\s+COUNTS/i.test(l));
  if (countsIdx >= 0) {
    preambleLines[countsIdx] = `M  V30 COUNTS ${totalAtoms} ${totalBonds} 0 0 0`;
  }

  const out = [
    preambleLines.join("\n"),
    "M  V30 BEGIN ATOM",
    ...p.atomLines,
    ...newAtomLines,
    "M  V30 END ATOM",
    "M  V30 BEGIN BOND",
    ...p.bondLines,
    ...newBondLines,
    ...connectingBonds,
    "M  V30 END BOND",
    p.trailer,
  ].join("\n");

  return out;
}
