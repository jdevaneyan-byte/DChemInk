// tests/chem/naming/engine.tier2.test.ts
//
// End-to-end Tier-2 corpus: SMILES → nameMolecule (via graphFromSmiles + RDKit).
// Each expected name is cross-checked against PubChem; systematic-vs-retained
// mismatches (where PubChem gives a retained trivial name) are documented inline
// and we assert the SYSTEMATIC PIN.
//
// PubChem cross-check results (2026-05-22):
//   CC(=O)O  → "acetic acid"     (retained); assert systematic "ethanoic acid"
//   CC=O     → "acetaldehyde"    (retained); assert systematic "ethanal"
//   CC#N     → "acetonitrile"    (retained); assert systematic "ethanenitrile"
//   CC(=O)N  → "acetamide"       (retained); assert systematic "ethanamide"
//   CCC(=O)O → "propanoic acid"  (systematic) ✓
//   CCC=O    → "propanal"        (systematic) ✓
//   CC(=O)C  → "propan-2-one"    (systematic) ✓
//   CCC(=O)C → "butan-2-one"     (systematic) ✓
//   CCO      → "ethanol"         (systematic) ✓
//   CC(O)C   → "propan-2-ol"     (systematic) ✓
//   OCC(C)C  → "2-methylpropan-1-ol" (systematic) ✓
//   OCCO     → "ethane-1,2-diol" (systematic) ✓
//   CCN      → "ethanamine"      (systematic) ✓
//   CCC#N    → "propanenitrile"  (systematic) ✓
//   CCCl     → "chloroethane"    (systematic) ✓
//   OCC(=O)O → "2-hydroxyacetic acid" (systematic/PubChem) ✓
//   OCCC(=O)O→ "3-hydroxypropanoic acid" (systematic) ✓
//   C=CC(=O)O→ "prop-2-enoic acid" (systematic) ✓
//   CC(=O)C=C→ "but-3-en-2-one"  (systematic) ✓
//   COC      → "methoxymethane"  (systematic) ✓
//   CCOC     → "methoxyethane"   (systematic) ✓
//   OC(=O)CCCCC(=O)O → "hexanedioic acid" (systematic) ✓
//   ClCC(Cl)C → "1,2-dichloropropane" (systematic) ✓
//   FC(F)F   → "fluoroform"      (retained); assert systematic "trifluoromethane"

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function name(smiles: string): string | null {
  const g = graphFromSmiles(smiles);
  if (!g) return null;
  return nameMolecule(g).name;
}

function status(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) return "error";
  return nameMolecule(g).status;
}


describe("nameMolecule (Tier 2 end-to-end)", () => {
  // ── Carboxylic acids ─────────────────────────────────────────────────────────
  it("CC(=O)O → ethanoic acid (PubChem: acetic acid, retained; we use systematic)", () => {
    expect(name("CC(=O)O")).toBe("ethanoic acid");
  });
  it("CCC(=O)O → propanoic acid", () => {
    expect(name("CCC(=O)O")).toBe("propanoic acid");
  });
  it("OC(=O)CCCCC(=O)O → hexanedioic acid (diacid multiplicity)", () => {
    expect(name("OC(=O)CCCCC(=O)O")).toBe("hexanedioic acid");
  });

  // ── Aldehydes ─────────────────────────────────────────────────────────────────
  it("CC=O → ethanal (PubChem: acetaldehyde, retained; we use systematic)", () => {
    expect(name("CC=O")).toBe("ethanal");
  });
  it("CCC=O → propanal", () => {
    expect(name("CCC=O")).toBe("propanal");
  });

  // ── Ketones ────────────────────────────────────────────────────────────────────
  it("CC(=O)C → propan-2-one", () => {
    expect(name("CC(=O)C")).toBe("propan-2-one");
  });
  it("CCC(=O)C → butan-2-one", () => {
    expect(name("CCC(=O)C")).toBe("butan-2-one");
  });

  // ── Alcohols ─────────────────────────────────────────────────────────────────
  it("CCO → ethanol", () => {
    expect(name("CCO")).toBe("ethanol");
  });
  it("CC(O)C → propan-2-ol", () => {
    expect(name("CC(O)C")).toBe("propan-2-ol");
  });
  it("OCC(C)C → 2-methylpropan-1-ol", () => {
    expect(name("OCC(C)C")).toBe("2-methylpropan-1-ol");
  });
  it("OCCO → ethane-1,2-diol (diol multiplicity)", () => {
    expect(name("OCCO")).toBe("ethane-1,2-diol");
  });

  // ── Amines ───────────────────────────────────────────────────────────────────
  it("CCN → ethanamine", () => {
    expect(name("CCN")).toBe("ethanamine");
  });

  // ── Nitriles ─────────────────────────────────────────────────────────────────
  it("CC#N → ethanenitrile (PubChem: acetonitrile, retained; we use systematic)", () => {
    expect(name("CC#N")).toBe("ethanenitrile");
  });
  it("CCC#N → propanenitrile", () => {
    expect(name("CCC#N")).toBe("propanenitrile");
  });

  // ── Amides ───────────────────────────────────────────────────────────────────
  it("CC(=O)N → ethanamide (PubChem: acetamide, retained; we use systematic)", () => {
    expect(name("CC(=O)N")).toBe("ethanamide");
  });

  // ── Halides ──────────────────────────────────────────────────────────────────
  it("CCCl → chloroethane", () => {
    expect(name("CCCl")).toBe("chloroethane");
  });
  it("FC(F)F → trifluoromethane (PubChem: fluoroform, retained; we use systematic)", () => {
    expect(name("FC(F)F")).toBe("trifluoromethane");
  });
  it("ClCC(Cl)C → 1,2-dichloropropane", () => {
    expect(name("ClCC(Cl)C")).toBe("1,2-dichloropropane");
  });

  // ── Ethers ───────────────────────────────────────────────────────────────────
  it("COC → methoxymethane", () => {
    expect(name("COC")).toBe("methoxymethane");
  });
  it("CCOC → methoxyethane", () => {
    expect(name("CCOC")).toBe("methoxyethane");
  });

  // ── Mixed seniority (acid > alcohol) ─────────────────────────────────────────
  it("OCC(=O)O → 2-hydroxyethanoic acid (PubChem: 2-hydroxyacetic acid; systematic form)", () => {
    // PubChem: "2-hydroxyacetic acid" — we emit systematic "2-hydroxyethanoic acid"
    expect(name("OCC(=O)O")).toBe("2-hydroxyethanoic acid");
  });
  it("OCCC(=O)O → 3-hydroxypropanoic acid", () => {
    expect(name("OCCC(=O)O")).toBe("3-hydroxypropanoic acid");
  });

  // ── Unsaturation + functional group ──────────────────────────────────────────
  it("C=CC(=O)O → prop-2-enoic acid (acrylic acid)", () => {
    expect(name("C=CC(=O)O")).toBe("prop-2-enoic acid");
  });
  it("CC(=O)C=C → but-3-en-2-one", () => {
    expect(name("CC(=O)C=C")).toBe("but-3-en-2-one");
  });

  // ── Rejections ───────────────────────────────────────────────────────────────
  it("CC(=O)OC (ester) → methyl ethanoate (Tier 2b implemented; PubChem: methyl acetate, retained)", () => {
    // Engine routing added in Task 3. PubChem: "methyl acetate" (retained); we assert systematic.
    expect(name("CC(=O)OC")).toBe("methyl ethanoate");
  });
  it("c1ccccc1 (ring) → named 'benzene' in Tier 3", () => {
    // Benzene is now named by Tier 3.
    expect(status("c1ccccc1")).toBe("named");
    expect(name("c1ccccc1")).toBe("benzene");
  });
  it("CC(=O)[O-] (charged) → unsupported", () => {
    expect(status("CC(=O)[O-]")).toBe("unsupported");
  });
  // Dual carbon-bearing groups: acid (senior) is the suffix, nitrile demotes to a
  // cyano PREFIX whose carbon leaves the parent chain (not double-counted).
  // Round-trips through OPSIN to the original structure.
  it("N#CC#CC(=O)O (cyano-ynoic acid) → 3-cyanoprop-2-ynoic acid", () => {
    expect(name("N#CC#CC(=O)O")).toBe("3-cyanoprop-2-ynoic acid");
  });
  // Atom-completeness guard: N-substituted (secondary/tertiary) amines aren't
  // expressible yet (no N-locants), so we DECLINE rather than drop the N-substituent.
  it("CNC (dimethylamine) → unsupported, not 'methanamine'", () => {
    expect(status("CNC")).toBe("unsupported");
  });
  // An on-chain enol IS nameable (vinyl alcohol). PubChem/OPSIN: C=CO → ethenol.
  it("C=CO → ethenol (on-chain C=C, named not declined)", () => {
    expect(name("C=CO")).toBe("ethenol");
  });
  // Multiple-bond guard: a vinyl branch stranded off the acid's parent chain
  // can't be expressed (no alkenyl substituents yet) → declined, not mis-named.
  it("C=CC(C=C)C(=O)O (off-chain C=C) → unsupported", () => {
    expect(status("C=CC(C=C)C(=O)O")).toBe("unsupported");
  });
});

// Tier-1 regression: the original engine test corpus must still pass through nameMolecule
describe("Tier-1 regression (engine.tier2.test)", () => {
  it("methane → methane", () => {
    expect(name("C")).toBe("methane");
  });
  it("propane → propane", () => {
    expect(name("CCC")).toBe("propane");
  });
  it("2-methylbutane → 2-methylbutane", () => {
    expect(name("CCC(C)C")).toBe("2-methylbutane");
  });
  it("pent-2-ene → pent-2-ene", () => {
    expect(name("CC=CCC")).toBe("pent-2-ene");
  });
});

// ── Locant priority: unsaturation > detachable prefixes ──────────────────────
//
// IUPAC 2013 P-44.1: when there is no suffix-PCG, C=C/C≡C gets lowest locants
// BEFORE detachable prefixes. The engine was passing prefix-group carbons as
// pcgCarbons, incorrectly giving them PCG-level priority over unsaturation.
//
// PubChem-verified expected names below.
describe("locant priority: unsaturation beats prefix groups (no suffix PCG)", () => {
  it("C=CCF → 3-fluoroprop-1-ene (C=C gets locant 1, not F)", () => {
    // Bug gave: 1-fluoroprop-2-ene
    expect(name("C=CCF")).toBe("3-fluoroprop-1-ene");
  });

  it("C#CCC(C)Br → 4-bromopent-1-yne (C≡C gets locant 1)", () => {
    // Bug gave: 2-bromopent-4-yne
    expect(name("C#CCC(C)Br")).toBe("4-bromopent-1-yne");
  });

  it("C=C(C)CBr → 3-bromo-2-methylprop-1-ene (C=C gets locant 1)", () => {
    // Bug gave: 1-bromo-2-methylprop-2-ene
    expect(name("C=C(C)CBr")).toBe("3-bromo-2-methylprop-1-ene");
  });

  it("C#CC(C)F → 3-fluorobut-1-yne (C≡C gets locant 1)", () => {
    // Bug gave: 2-fluorobut-3-yne
    expect(name("C#CC(C)F")).toBe("3-fluorobut-1-yne");
  });

  it("C#CC#CCCl → 5-chloropenta-1,3-diyne (C≡C gets locants 1,3)", () => {
    // Bug gave: 1-chloropenta-2,4-diyne
    expect(name("C#CC#CCCl")).toBe("5-chloropenta-1,3-diyne");
  });

  it("C=CC(C)(C)CBr → 4-bromo-3,3-dimethylbut-1-ene (C=C locant 1)", () => {
    // Bug gave: 1-bromo-2,2-dimethylbut-3-ene
    expect(name("C=CC(C)(C)CBr")).toBe("4-bromo-3,3-dimethylbut-1-ene");
  });

  // Sanity: lone prefix on saturated chain still gets lowest locant
  it("CC(Cl)CCCC → 2-chlorohexane (no unsaturation; prefix gets lowest locant)", () => {
    expect(name("CC(Cl)CCCC")).toBe("2-chlorohexane");
  });
});

// ── Locant priority: FG prefixes enter the detachable-prefix locant + alpha tie-break ──
//
// When unsaturation locants tie between two directions, the prefix set (including
// FG prefixes like methoxy, chloro) must be considered in the next tier.
// And alphabetical tie-break must include FG prefix names.
describe("locant priority: FG prefixes in tie-break", () => {
  // COC(C)C(C)C → 2-methoxy-3-methylbutane
  // Both directions give same unsaturation locants (none). Prefix locants:
  // direction A: methoxy@2, methyl@3 → set {2,3}
  // direction B: methoxy@3, methyl@2 → set {2,3} (tie on set)
  // Alpha tie-break: methoxy (m-e-t-h-O) < methyl (m-e-t-h-Y) → methoxy gets lower locant
  // → methoxy@2, methyl@3 → 2-methoxy-3-methylbutane
  it("COC(C)C(C)C → 2-methoxy-3-methylbutane (alpha tie: methoxy < methyl)", () => {
    // Bug gave: 3-methoxy-2-methylbutane (FG prefix not in locant comparison)
    expect(name("COC(C)C(C)C")).toBe("2-methoxy-3-methylbutane");
  });
});

// ── Chain selection: FG prefix carbons must not distort parent chain ──────────
//
// CCC(CC)CF → CH2F is a substituent on the longest C5 chain.
// When F is wrongly treated as PCG, C3 (bearing CH2F) becomes a chain terminus,
// making a 4-carbon chain selected over the true longest 5-carbon chain.
describe("chain selection: prefix FG does not distort parent chain", () => {
  it("CCC(CC)CF → 3-(fluoromethyl)pentane (C5 is parent; CH2F is substituent)", () => {
    // Bug gave: 2-ethyl-1-fluorobutane (wrong C4 parent selected due to F-as-PCG)
    expect(name("CCC(CC)CF")).toBe("3-(fluoromethyl)pentane");
  });
});

// ── Euphony: hept-1-en-3,5-diyne (no -a- before single ene) ─────────────────
describe("euphony: no -a- before single ene when followed by multiplied yne", () => {
  it("C=CC#CC#CC → hept-1-en-3,5-diyne (no 'a' linker)", () => {
    // Bug gave: hepta-1-en-3,5-diyne
    // PubChem IUPAC: hept-1-en-3,5-diyne
    expect(name("C=CC#CC#CC")).toBe("hept-1-en-3,5-diyne");
  });
});
