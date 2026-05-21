import type { MolProperties } from "./properties";

/**
 * One glossary entry per displayed property. `definition` says what the
 * descriptor means scientifically, `method` describes how it's computed in
 * general, and `perMolecule` produces a sentence that quotes the *current*
 * molecule's value so the modal text differs per structure.
 */
export interface GlossaryEntry {
  term: string;
  definition: string;
  method: string;
  perMolecule: (p: MolProperties) => string;
}

/**
 * Keyed by the property label EXACTLY as it appears in {@link
 * import("./properties").propertiesToRows} / the PropertiesPanel.
 */
export const PROPERTY_GLOSSARY: Record<string, GlossaryEntry> = {
  Formula: {
    term: "Molecular Formula",
    definition:
      "The count of each element in the molecule, including hydrogens. Written in Hill order: carbon first, hydrogen second, then the remaining elements alphabetically.",
    method:
      "Atoms are tallied by element (explicit plus implicit hydrogens) and emitted in Hill order, as RDKit's CalcMolFormula does.",
    perMolecule: (p) => `This molecule's formula is ${p.formula}.`,
  },
  "Molecular Weight": {
    term: "Molecular Weight",
    definition:
      "The average mass of the molecule in g/mol, using the standard (isotope-averaged) atomic weights of its atoms.",
    method:
      "Sum of standard atomic weights of all atoms, including implicit hydrogens.",
    perMolecule: (p) =>
      `This molecule weighs ${p.molWt.toFixed(2)} g/mol (average atomic masses).`,
  },
  "Exact Mass": {
    term: "Exact Mass (Monoisotopic Mass)",
    definition:
      "The mass of the molecule computed from the most-abundant isotope of each element — the value a high-resolution mass spectrometer reports for the molecular ion.",
    method:
      "Sum of the most-abundant isotope masses of all atoms, including implicit hydrogens.",
    perMolecule: (p) =>
      `This molecule's exact mass is ${p.exactMass.toFixed(4)} Da.`,
  },
  cLogP: {
    term: "cLogP (Calculated logP)",
    definition:
      "The calculated octanol/water partition coefficient, a measure of lipophilicity. Higher values mean more lipophilic; it is a key driver of membrane permeability and solubility.",
    method:
      "Wildman–Crippen atom-contribution method: sum of per-atom logP contributions.",
    perMolecule: (p) =>
      `Computed value for this molecule: ${p.cLogP.toFixed(2)} (sum of atomic contributions).`,
  },
  "Molar Refractivity": {
    term: "Molar Refractivity",
    definition:
      "A measure of the total polarizability (and effectively the molar volume) of the molecule, correlated with molecular size and dispersion interactions.",
    method:
      "Wildman–Crippen atom-contribution method: sum of per-atom molar-refractivity contributions.",
    perMolecule: (p) =>
      `Computed value for this molecule: ${p.molarRefractivity.toFixed(2)}.`,
  },
  TPSA: {
    term: "TPSA (Topological Polar Surface Area)",
    definition:
      "The surface area (in Å²) of the molecule's polar atoms — chiefly N, O and their attached H. It predicts membrane permeability and oral absorption; values above ~140 Å² generally show poor permeability.",
    method:
      "Ertl's topological polar surface area: sum of polar fragment contributions (no 3D coordinates needed).",
    perMolecule: (p) =>
      `This molecule has a TPSA of ${p.tpsa.toFixed(2)} Å².`,
  },
  HBD: {
    term: "Hydrogen-Bond Donors",
    definition:
      "The number of hydrogen-bond donor groups — heteroatoms bearing at least one hydrogen, i.e. N–H and O–H.",
    method:
      "Counts heteroatoms (mainly N and O) that carry one or more attached hydrogens.",
    perMolecule: (p) =>
      `This molecule has ${p.hbd} hydrogen-bond donor(s) (N–H / O–H).`,
  },
  HBA: {
    term: "Hydrogen-Bond Acceptors",
    definition:
      "The number of hydrogen-bond acceptor atoms — typically nitrogen and oxygen atoms with a lone pair available to accept a hydrogen bond.",
    method:
      "Counts acceptor heteroatoms (mainly N and O) using RDKit's NumHBA definition.",
    perMolecule: (p) =>
      `This molecule has ${p.hba} hydrogen-bond acceptor(s).`,
  },
  "Rotatable Bonds": {
    term: "Rotatable Bonds",
    definition:
      "The number of single, non-ring bonds to non-terminal heavy atoms about which the molecule can freely rotate. It is a measure of molecular flexibility.",
    method:
      "Counts single bonds that are not in a ring and not to a terminal atom (amide C–N bonds are excluded).",
    perMolecule: (p) =>
      `This molecule has ${p.rotatableBonds} rotatable bond(s).`,
  },
  "Heavy Atoms": {
    term: "Heavy Atoms",
    definition:
      "The number of non-hydrogen atoms in the molecule — a simple measure of molecular size.",
    method: "Counts all atoms except hydrogen.",
    perMolecule: (p) => `This molecule has ${p.heavyAtoms} heavy (non-H) atom(s).`,
  },
  Heteroatoms: {
    term: "Heteroatoms",
    definition:
      "The number of atoms that are neither carbon nor hydrogen (e.g. N, O, S, halogens).",
    method: "Counts all atoms that are not carbon and not hydrogen.",
    perMolecule: (p) => `This molecule has ${p.heteroatoms} heteroatom(s) (non-C, non-H).`,
  },
  Rings: {
    term: "Rings",
    definition:
      "The number of rings in the molecule's smallest set of smallest rings (SSSR) — the count of independent ring closures.",
    method: "Counts rings via the smallest set of smallest rings (SSSR).",
    perMolecule: (p) =>
      `This molecule has ${p.rings} ring(s), ${p.aromaticRings} aromatic.`,
  },
  "Aromatic Rings": {
    term: "Aromatic Rings",
    definition:
      "The number of rings that satisfy aromaticity (a cyclic, planar, fully conjugated π system), such as benzene or pyridine rings.",
    method: "Counts SSSR rings whose atoms are all flagged aromatic after perception.",
    perMolecule: (p) =>
      `This molecule has ${p.aromaticRings} aromatic ring(s) out of ${p.rings} total.`,
  },
  "Fraction Csp3": {
    term: "Fraction Csp3 (Fsp3)",
    definition:
      "The fraction of carbon atoms that are sp³-hybridized (0–1). Higher values indicate greater three-dimensionality and often correlate with improved developability.",
    method:
      "Number of sp³ carbons divided by the total number of carbon atoms.",
    perMolecule: (p) =>
      `For this molecule Fsp3 = ${p.fractionCsp3.toFixed(2)} (fraction of carbons that are sp³).`,
  },
  Stereocenters: {
    term: "Stereocenters",
    definition:
      "The number of atoms whose configuration gives rise to stereoisomers — chiefly tetrahedral chiral centers (both assigned and unassigned).",
    method:
      "Counts atom-centered stereocenters (RDKit NumAtomStereoCenters), including unspecified ones.",
    perMolecule: (p) => `This molecule has ${p.stereocenters} atomic stereocenter(s).`,
  },
  "Amide Bonds": {
    term: "Amide Bonds",
    definition:
      "The number of amide linkages (C(=O)–N), the bond that joins amino acids into peptides and a common motif in drugs.",
    method: "Counts substructure matches of the carbonyl-to-nitrogen amide bond.",
    perMolecule: (p) => `This molecule has ${p.amideBonds} amide bond(s).`,
  },
  "Lipinski HBA": {
    term: "Lipinski HBA",
    definition:
      "The hydrogen-bond acceptor count under Lipinski's Rule of Five, where it is simply the number of nitrogen and oxygen atoms. The rule suggests ≤ 10 for good oral absorption.",
    method:
      "Lipinski's simplified count: the number of N and O atoms in the molecule.",
    perMolecule: (p) =>
      `This molecule has ${p.lipinskiHBA} Lipinski acceptor(s) (N + O count); the rule's limit is 10.`,
  },
  "Lipinski HBD": {
    term: "Lipinski HBD",
    definition:
      "The hydrogen-bond donor count under Lipinski's Rule of Five — the number of N–H and O–H hydrogens. The rule suggests ≤ 5 for good oral absorption.",
    method:
      "Lipinski's simplified count: the total number of hydrogens on N and O atoms.",
    perMolecule: (p) =>
      `This molecule has ${p.lipinskiHBD} Lipinski donor(s) (N–H + O–H count); the rule's limit is 5.`,
  },
};
