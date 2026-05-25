// tests/chem/naming/engine.tier4.stage4.task2.test.ts
//
// Task 2 — Tier 4 Stage 4: heteroatom-replacement spiro + substituents,
// unsaturation, and suffix functional groups on monospiro ring systems.
//
// Convention: the engine emits IUPAC PREFERRED-name locants, i.e. the LOWEST
// locant consistent with the spiro numbering rules. For symmetric skeletons
// where two locants are equivalent, PubChem's namer (Lexichem) sometimes prints
// the HIGHER equivalent locant; we deliberately print the lower one (matches the
// IUPAC rule and ChemDraw). Such cases are annotated "[IUPAC<PubChem]" below.
// Heteroatoms always take the lowest locants — verified against PubChem.
//
// PubChem ground-truth (smiles → PubChem IUPACName):
//   C1CCC2(CC1)OCCO2     → 1,4-dioxaspiro[4.5]decane      ✓ match
//   C1CCC2(CC1)CCCO2     → 1-oxaspiro[4.5]decane          ✓ match
//   C1CCC2(CC1)CCCN2     → 1-azaspiro[4.5]decane          ✓ match
//   O1CCC2(C1)CCCCC2     → 2-oxaspiro[4.5]decane          ✓ match
//   C1CC2(CCO2)CCC1      → 1-oxaspiro[3.5]nonane          ✓ match
//   C1CCC2(CC1)OCCCC2    → 1-oxaspiro[5.5]undecane        ✓ match (equal-ring fix)
//   C1CC2(CCCN2)CC1      → 1-azaspiro[4.4]nonane          ✓ match (equal-ring fix)
//   CC1CCC2(CC1)CCCC2    → 8-methylspiro[4.5]decane       ✓ match
//   NC1CCC2(CCCCC2)CC1   → spiro[5.5]undecan-3-amine      ✓ match
//   C1CCC2(C1)CCC(=O)CC2 → spiro[4.5]decan-8-one          ✓ match
//   CC1CC12CC2           → 2-methylspiro[2.2]pentane      [IUPAC 1 < PubChem 2]
//   CC1(C)CCC12CCC2      → 3,3-dimethylspiro[3.3]heptane  [IUPAC 1,1 < PubChem 3,3]
//   C1CCC2(CC1)CCC(=O)C2 → spiro[4.5]decan-3-one          [IUPAC 2 < PubChem 3]
//   OC1CCCC2(CCCC2)C1    → spiro[4.5]decan-9-ol           [IUPAC 7 < PubChem 9]

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
  if (!g) throw new Error(`graphFromSmiles failed: ${smiles}`);
  return nameMolecule(g).name;
}

describe("T4S4 Task2 – heteroatom replacement (lowest locants, PubChem-matched)", () => {
  it("1,4-dioxaspiro[4.5]decane (cyclohexanone ethylene ketal)", () => {
    expect(name("C1CCC2(CC1)OCCO2")).toBe("1,4-dioxaspiro[4.5]decane");
  });
  it("1-oxaspiro[4.5]decane", () => {
    expect(name("C1CCC2(CC1)CCCO2")).toBe("1-oxaspiro[4.5]decane");
  });
  it("1-azaspiro[4.5]decane", () => {
    expect(name("C1CCC2(CC1)CCCN2")).toBe("1-azaspiro[4.5]decane");
  });
  it("2-oxaspiro[4.5]decane (O not adjacent to spiro)", () => {
    expect(name("O1CCC2(C1)CCCCC2")).toBe("2-oxaspiro[4.5]decane");
  });
  it("1-oxaspiro[3.5]nonane (different-size rings)", () => {
    expect(name("C1CC2(CCO2)CCC1")).toBe("1-oxaspiro[3.5]nonane");
  });
});

describe("T4S4 Task2 – equal-size rings: heteroatom ring numbered first", () => {
  // Regression: when both rings are the same size, the heteroatom-bearing ring
  // must be numbered first so the heteroatom gets the lowest locant.
  it("1-oxaspiro[5.5]undecane (was 7-oxa before fix)", () => {
    expect(name("C1CCC2(CC1)OCCCC2")).toBe("1-oxaspiro[5.5]undecane");
  });
  it("1-azaspiro[4.4]nonane (was 6-aza before fix)", () => {
    expect(name("C1CC2(CCCN2)CC1")).toBe("1-azaspiro[4.4]nonane");
  });
});

describe("T4S4 Task2 – substituents (IUPAC lowest locant)", () => {
  it("8-methylspiro[4.5]decane (unique mid-ring position)", () => {
    expect(name("CC1CCC2(CC1)CCCC2")).toBe("8-methylspiro[4.5]decane");
  });
  it("1-methylspiro[2.2]pentane [IUPAC 1 < PubChem 2]", () => {
    expect(name("CC1CC12CC2")).toBe("1-methylspiro[2.2]pentane");
  });
  it("1,1-dimethylspiro[3.3]heptane [IUPAC 1,1 < PubChem 3,3]", () => {
    expect(name("CC1(C)CCC12CCC2")).toBe("1,1-dimethylspiro[3.3]heptane");
  });
});

describe("T4S4 Task2 – functional-group suffixes", () => {
  it("spiro[5.5]undecan-3-amine", () => {
    expect(name("NC1CCC2(CCCCC2)CC1")).toBe("spiro[5.5]undecan-3-amine");
  });
  it("spiro[4.5]decan-8-one (ketone in larger ring, unique position)", () => {
    expect(name("C1CCC2(C1)CCC(=O)CC2")).toBe("spiro[4.5]decan-8-one");
  });
  it("spiro[4.5]decan-2-one [IUPAC 2 < PubChem 3]", () => {
    expect(name("C1CCC2(CC1)CCC(=O)C2")).toBe("spiro[4.5]decan-2-one");
  });
  it("spiro[4.5]decan-7-ol [IUPAC 7 < PubChem 9]", () => {
    expect(name("OC1CCCC2(CCCC2)C1")).toBe("spiro[4.5]decan-7-ol");
  });
});

describe("T4S4 Task2 – declines out-of-scope (no wrong names)", () => {
  it("spiro lactone (ring O + carbonyl) declines rather than mis-name", () => {
    // O=C1CCC2(CCCCC2)O1 is 1-oxaspiro[4.5]decan-2-one in PubChem; the engine
    // does not yet combine ring-heteroatom replacement with a suffix carbonyl,
    // so it declines (never a wrong name).
    const r = nameMolecule(graphFromSmiles("O=C1CCC2(CCCCC2)O1")!);
    expect(r.name).toBeNull();
    expect(r.status).toBe("unsupported");
  });
});
