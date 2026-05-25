// src/chem/naming/graph.ts
export type NameStatus = "named" | "unsupported" | "empty" | "error";

export interface NamingAtom {
  index: number;        // 0-based, stable within the graph
  element: string;      // "C", "O", "N", ...
  charge: number;
  hydrogens: number;    // total attached H (implicit + explicit)
  aromatic: boolean;
  ringIds: number[];    // SSSR ring memberships; empty for acyclic
}
export interface NamingBond {
  from: number;
  to: number;
  order: 1 | 2 | 3;     // kekulized for naming
  aromatic: boolean;
}
/** A specified C=C double-bond stereo element (CIP E/Z), atom indices + label. */
export interface StereoBond {
  a: number;
  b: number;
  label: "E" | "Z";
}
export interface MolGraph {
  atoms: NamingAtom[];
  bonds: NamingBond[];
  fragmentCount: number;
  /** CIP R/S for SPECIFIED tetrahedral stereocenters (atom index → label). */
  stereoAtoms?: Map<number, "R" | "S">;
  /** CIP E/Z for SPECIFIED double bonds. */
  stereoBonds?: StereoBond[];
}
export interface NameResult {
  name: string | null;
  status: NameStatus;
  reason?: string;        // when unsupported
  verified?: boolean;     // OPSIN round-trip matched
  parentChain?: number[]; // chosen main-chain atom indices (highlight, T1+)
}

const STEMS = [
  "", "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec",
  "undec", "dodec", "tridec", "tetradec", "pentadec", "hexadec", "heptadec",
  "octadec", "nonadec", "icos",
];
export function parentStem(n: number): string {
  if (n >= 1 && n < STEMS.length) return STEMS[n];
  throw new Error(`parentStem: unsupported chain length ${n}`);
}

const MULT = ["", "", "di", "tri", "tetra", "penta", "hexa", "hepta", "octa", "nona", "deca"];
export function multiplierPrefix(n: number): string {
  if (n === 1) return "";
  if (n >= 2 && n < MULT.length) return MULT[n];
  throw new Error(`multiplierPrefix: unsupported count ${n}`);
}

/** Compare two ascending locant arrays; -1 if `a` is lower at first difference. */
export function compareLocants(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
