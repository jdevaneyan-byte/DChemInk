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

function reason(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) return "";
  return nameMolecule(g).reason ?? "";
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
  // Note: CC(=O)OC (ester) end-to-end naming is tested in engine.tier2b.test.ts
  // (requires engine routing, added in Task 3). Here we just check structural rejection.
  it("CC(=O)OC (ester) → unsupported until engine routing (task 3)", () => {
    // The engine doesn't yet route esters; completeness guard fires.
    // This test is replaced by a proper named test in engine.tier2b.test.ts after Task 3.
    expect(status("CC(=O)OC")).toBe("unsupported");
  });
  it("c1ccccc1 (ring) → unsupported mentioning ring", () => {
    expect(status("c1ccccc1")).toBe("unsupported");
    expect(reason("c1ccccc1")).toMatch(/ring/i);
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
