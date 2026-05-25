// src/chem/naming/adapter.ts
import { parseSmiles } from "../rdkit";
import type { MolGraph, NamingAtom, NamingBond, StereoBond } from "./graph";

const SYMBOL: Record<number, string> = {
  1: "H", 5: "B", 6: "C", 7: "N", 8: "O", 9: "F", 14: "Si", 15: "P",
  16: "S", 17: "Cl", 35: "Br", 53: "I",
};

// CommonChem JSON structure as emitted by RDKit 2025.3.4
// Defaults are declared in json.defaults.atom / json.defaults.bond;
// fields that match the default are OMITTED from individual atoms/bonds.
// Confirmed defaults: atom.z=6 (carbon), atom.impHs=0, atom.chg=0, bond.bo=1
// atomRings lives under molecules[0].extensions[N].atomRings (rdkitRepresentation ext)
interface CommonChemAtom {
  z?: number;       // atomic number; omitted when = 6 (carbon, the default)
  chg?: number;     // formal charge; omitted when = 0
  impHs?: number;   // implicit H count; omitted when = 0
  stereo?: string;  // "cw" | "ccw" for a SPECIFIED tetrahedral parity (RDKit clears non-stereogenic)
}
interface CommonChemBond {
  bo?: number;              // bond order; omitted when = 1 (single, the default)
  atoms: [number, number];  // always present
  stereo?: string;          // "cis" | "trans" for a SPECIFIED double-bond parity
}
interface CommonChemExtension {
  name?: string;
  atomRings?: number[][];  // SSSR ring membership (rdkitRepresentation extension)
  [key: string]: unknown;
}
interface CommonChemMol {
  atoms: CommonChemAtom[];
  bonds: CommonChemBond[];
  extensions?: CommonChemExtension[];
}

/** Count connected components over the atom bond graph (union-find). */
function countFragments(n: number, bonds: NamingBond[]): number {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const b of bonds) parent[find(b.from)] = find(b.to);
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}

export function graphFromSmiles(smiles: string): MolGraph | null {
  const mol = parseSmiles(smiles);
  if (!mol) return null;
  try {
    const json = JSON.parse(mol.get_json()) as {
      molecules?: CommonChemMol[];
      defaults?: { atom?: CommonChemAtom; bond?: CommonChemBond };
    };
    const m = json.molecules?.[0];
    if (!m) return null;

    // atomRings is in the rdkitRepresentation extension (first extension that has it)
    const rings: number[][] =
      m.extensions?.find((e) => Array.isArray(e.atomRings))?.atomRings ?? [];

    const ringIdsFor = (i: number): number[] =>
      rings.flatMap((r, ri) => (r.includes(i) ? [ri] : []));

    const atoms: NamingAtom[] = m.atoms.map((a, i) => ({
      index: i,
      // z omitted from atom when it equals the default (6 = carbon)
      element: SYMBOL[a.z ?? 6] ?? `Z${a.z ?? 6}`,
      charge: a.chg ?? 0,
      hydrogens: a.impHs ?? 0,
      aromatic: false,
      ringIds: ringIdsFor(i),
    }));

    const bonds: NamingBond[] = m.bonds.map((b) => {
      // bo omitted from bond when it equals the default (1 = single)
      const bo = b.bo ?? 1;
      const order: 1 | 2 | 3 = bo === 2 ? 2 : bo === 3 ? 3 : 1;
      return { from: b.atoms[0], to: b.atoms[1], order, aromatic: bo === 12 };
    });

    // CC.CC appears as ONE molecule entry with disconnected atoms — use union-find
    const fragmentCount = countFragments(atoms.length, bonds);

    // ── Stereodescriptors (CIP) ─────────────────────────────────────────────
    // RDKit assigns CIP labels only for SPECIFIED stereo (@/@@, /\, wedges).
    // get_stereo_tags(): { CIP_atoms: [[idx,"(R)"|"(S)"]], CIP_bonds: [[a,b,"(E)"|"(Z)"]] }
    // We accept only UPPERCASE R/S and E/Z (true CIP). RDKit also emits lowercase
    // (r)/(s) for pseudoasymmetric / cis-trans ring centers, which we cannot yet
    // express — those are detected via specifiedStereoCount and lead to a decline.
    const { stereoAtoms, stereoBonds } = extractStereo(mol);

    // Count SPECIFIED stereo parity (independent of CIP label case): RDKit clears
    // parity on non-stereogenic atoms, so atom.stereo/bond.stereo mark exactly the
    // stereo the input pinned down. If this exceeds the uppercase descriptors we
    // can emit, the engine declines rather than drop stereo.
    const specifiedStereoCount =
      m.atoms.filter((a) => a.stereo === "cw" || a.stereo === "ccw").length +
      m.bonds.filter((b) => b.stereo === "cis" || b.stereo === "trans").length;

    // A "(?)" CIP tag marks a potential stereocenter RDKit could not assign
    // (undefined configuration / pseudoasymmetric). When such a centre coexists
    // with SPECIFIED stereo, the defined R/S labels are unreliable (their CIP
    // depends on the undefined neighbour) — the engine declines (no wrong names).
    const hasUndefinedStereo = undefinedStereo(mol);

    return { atoms, bonds, fragmentCount, stereoAtoms, stereoBonds, specifiedStereoCount, hasUndefinedStereo };
  } finally {
    mol.delete();
  }
}

interface StereoTags {
  CIP_atoms?: [number, string][];
  CIP_bonds?: [number, number, string][];
}

/** Strip CIP parentheses: "(R)" → "R", "(E)" → "E". */
function cipLabel(raw: string): string {
  return raw.replace(/[()]/g, "").trim();
}

function extractStereo(mol: { get_stereo_tags?: () => string }): {
  stereoAtoms?: Map<number, "R" | "S">;
  stereoBonds?: StereoBond[];
} {
  if (typeof mol.get_stereo_tags !== "function") return {};
  let tags: StereoTags;
  try {
    tags = JSON.parse(mol.get_stereo_tags()) as StereoTags;
  } catch {
    return {};
  }

  const stereoAtoms = new Map<number, "R" | "S">();
  for (const [idx, raw] of tags.CIP_atoms ?? []) {
    const label = cipLabel(raw);
    if (label === "R" || label === "S") stereoAtoms.set(idx, label);
  }

  const stereoBonds: StereoBond[] = [];
  for (const [a, b, raw] of tags.CIP_bonds ?? []) {
    const label = cipLabel(raw);
    if (label === "E" || label === "Z") stereoBonds.push({ a, b, label });
  }

  return {
    stereoAtoms: stereoAtoms.size > 0 ? stereoAtoms : undefined,
    stereoBonds: stereoBonds.length > 0 ? stereoBonds : undefined,
  };
}

/** True when get_stereo_tags reports any unassignable "(?)" stereocenter. */
function undefinedStereo(mol: { get_stereo_tags?: () => string }): boolean {
  if (typeof mol.get_stereo_tags !== "function") return false;
  try {
    const tags = JSON.parse(mol.get_stereo_tags()) as StereoTags;
    const atomQ = (tags.CIP_atoms ?? []).some(([, raw]) => cipLabel(raw) === "?");
    const bondQ = (tags.CIP_bonds ?? []).some(([, , raw]) => cipLabel(raw) === "?");
    return atomQ || bondQ;
  } catch {
    return false;
  }
}
