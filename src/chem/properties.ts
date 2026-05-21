import { parseSmiles } from "./rdkit";
import type { JSMol } from "@rdkit/rdkit";

export interface MolProperties {
  formula: string;
  molWt: number;
  exactMass: number;
  // Lipophilicity / solubility
  cLogP: number;
  molarRefractivity: number;
  tpsa: number;
  // H-bond / rotatable
  hbd: number;
  hba: number;
  rotatableBonds: number;
  // Atom counts
  heavyAtoms: number;
  heteroatoms: number;
  // Ring counts
  rings: number;
  aromaticRings: number;
  // Misc
  fractionCsp3: number;
  stereocenters: number;
  amideBonds: number;
  // Lipinski
  lipinskiHBA: number;
  lipinskiHBD: number;
}

interface DescriptorsJson {
  amw: number;
  exactmw: number;
  CrippenClogP: number;
  CrippenMR: number;
  tpsa: number;
  NumHBD: number;
  NumHBA: number;
  NumRotatableBonds: number;
  NumHeavyAtoms: number;
  NumHeteroatoms: number;
  NumRings: number;
  NumAromaticRings: number;
  FractionCSP3: number;
  NumAtomStereoCenters: number;
  NumAmideBonds: number;
  lipinskiHBA: number;
  lipinskiHBD: number;
}

/**
 * RDKit-JS `JSMol` may optionally expose a direct molecular-formula method on
 * some builds. The current `@rdkit/rdkit` typings (2025.3.4-1.0.0) do not
 * declare it and the WASM in this version does not export it either, but we
 * leave the optional method on the augmented type so we transparently pick it
 * up if a future RDKit-JS release adds it back.
 */
type JSMolWithFormula = JSMol & { get_molformula?: () => string };

/** Subset of the rdkitjson v12 mol blob that we care about for the formula. */
interface RdkitJson {
  defaults?: { atom?: { z?: number; impHs?: number } };
  molecules?: Array<{
    atoms?: Array<{ z?: number; impHs?: number }>;
  }>;
}

/** Periodic-table symbols indexed by atomic number (1–118). Index 0 is unused. */
const ELEMENT_SYMBOLS = [
  "",
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
  "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
  "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
  "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
  "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
];

/**
 * Compute a Hill-ordered molecular formula from RDKit's rdkitjson v12 blob.
 *
 * The format stores atom Z and implicit-H counts; explicit Hs would appear as
 * their own atoms (z=1). We sum both contributions per element and emit Carbon
 * first, Hydrogen second, then the remaining elements alphabetically — the
 * standard Hill system convention RDKit's own `CalcMolFormula` follows.
 */
function formulaFromRdkitJson(json: string): string {
  const parsed = JSON.parse(json) as RdkitJson;
  const mol = parsed.molecules?.[0];
  if (!mol?.atoms) return "";

  const defaultZ = parsed.defaults?.atom?.z ?? 6;
  const defaultImpHs = parsed.defaults?.atom?.impHs ?? 0;

  const counts = new Map<string, number>();
  const bump = (symbol: string, n: number) => {
    if (n <= 0) return;
    counts.set(symbol, (counts.get(symbol) ?? 0) + n);
  };

  for (const atom of mol.atoms) {
    const z = atom.z ?? defaultZ;
    const symbol = ELEMENT_SYMBOLS[z];
    if (!symbol) continue;
    bump(symbol, 1);
    const impHs = atom.impHs ?? defaultImpHs;
    bump("H", impHs);
  }

  const order: string[] = [];
  if (counts.has("C")) order.push("C");
  if (counts.has("H")) order.push("H");
  const rest = [...counts.keys()].filter((s) => s !== "C" && s !== "H").sort();
  order.push(...rest);

  return order
    .map((sym) => {
      const n = counts.get(sym)!;
      return n === 1 ? sym : `${sym}${n}`;
    })
    .join("");
}

/**
 * Compute basic molecular properties for a SMILES string.
 *
 * @returns A {@link MolProperties} object, or `null` if SMILES is invalid/empty.
 */
export function computeProperties(smiles: string): MolProperties | null {
  const mol = parseSmiles(smiles) as JSMolWithFormula | null;
  if (!mol) return null;

  try {
    const desc = JSON.parse(mol.get_descriptors()) as DescriptorsJson;

    // Prefer the native call if a future RDKit-JS build ships it; otherwise
    // derive the formula from rdkitjson v12.
    const formula =
      typeof mol.get_molformula === "function"
        ? mol.get_molformula()
        : formulaFromRdkitJson(mol.get_json());

    return {
      formula,
      molWt: desc.amw,
      exactMass: desc.exactmw,
      cLogP: desc.CrippenClogP,
      molarRefractivity: desc.CrippenMR,
      tpsa: desc.tpsa,
      hbd: desc.NumHBD,
      hba: desc.NumHBA,
      rotatableBonds: desc.NumRotatableBonds,
      heavyAtoms: desc.NumHeavyAtoms,
      heteroatoms: desc.NumHeteroatoms,
      rings: desc.NumRings,
      aromaticRings: desc.NumAromaticRings,
      fractionCsp3: desc.FractionCSP3,
      stereocenters: desc.NumAtomStereoCenters,
      amideBonds: desc.NumAmideBonds,
      lipinskiHBA: desc.lipinskiHBA,
      lipinskiHBD: desc.lipinskiHBD,
    };
  } finally {
    mol.delete();
  }
}

/**
 * Given a multi-fragment SMILES (`A.B.C`) and a target heavy-atom count, return
 * the single fragment whose heavy-atom count matches — used to show properties
 * for just the *selected* molecule. Returns null when there's only one fragment
 * or no fragment matches (caller falls back to the whole canvas).
 *
 * Identical fragments share the same count (and the same properties), so
 * returning the first match is fine.
 */
export function pickFragmentByAtomCount(
  allSmiles: string,
  targetHeavyAtoms: number,
): string | null {
  const parts = allSmiles.split(".").filter(Boolean);
  if (parts.length <= 1) return null;
  for (const part of parts) {
    const p = computeProperties(part);
    if (p && p.heavyAtoms === targetHeavyAtoms) return part;
  }
  return null;
}

/**
 * Ordered [label, value] pairs for a {@link MolProperties}, with each number
 * formatted for display:
 * - molWt → 2 dp, exactMass → 4 dp
 * - cLogP / molarRefractivity / tpsa / fractionCsp3 → 2 dp
 * - integer counts → no decimals
 */
export function propertiesToRows(props: MolProperties): [string, string][] {
  return [
    ["Formula", props.formula],
    ["Molecular Weight", props.molWt.toFixed(2)],
    ["Exact Mass", props.exactMass.toFixed(4)],
    ["cLogP", props.cLogP.toFixed(2)],
    ["Molar Refractivity", props.molarRefractivity.toFixed(2)],
    ["TPSA", props.tpsa.toFixed(2)],
    ["HBD", String(props.hbd)],
    ["HBA", String(props.hba)],
    ["Rotatable Bonds", String(props.rotatableBonds)],
    ["Heavy Atoms", String(props.heavyAtoms)],
    ["Heteroatoms", String(props.heteroatoms)],
    ["Rings", String(props.rings)],
    ["Aromatic Rings", String(props.aromaticRings)],
    ["Fraction Csp3", props.fractionCsp3.toFixed(2)],
    ["Stereocenters", String(props.stereocenters)],
    ["Amide Bonds", String(props.amideBonds)],
    ["Lipinski HBA", String(props.lipinskiHBA)],
    ["Lipinski HBD", String(props.lipinskiHBD)],
  ];
}

/** Two-column CSV (`Property,Value` header). */
export function propertiesToCsv(props: MolProperties): string {
  const body = propertiesToRows(props)
    .map(([label, value]) => `${label},${value}`)
    .join("\n");
  return `Property,Value\n${body}`;
}

/**
 * Tab-separated values — what spreadsheets (Excel, Google Sheets) split into
 * separate cells when you paste plain text. CSV pasted as plain text lands in
 * a single cell, which is why Copy writes TSV (and HTML) instead.
 */
export function propertiesToTsv(props: MolProperties): string {
  const body = propertiesToRows(props)
    .map(([label, value]) => `${label}\t${value}`)
    .join("\n");
  return `Property\tValue\n${body}`;
}

/** HTML `<table>` — pastes as a real formatted table into Word/Docs/Sheets. */
export function propertiesToHtmlTable(props: MolProperties): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = propertiesToRows(props)
    .map(
      ([label, value]) =>
        `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
}
