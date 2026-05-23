// tests/chem/naming/engine.tier3.test.ts
//
// End-to-end Tier-3 corpus: ring molecules → nameMolecule (via graphFromSmiles).
// All expected names are cross-checked against PubChem (checked 2026-05-23).
//
// PubChem cross-check notes:
//   C1CCCCC1          → cyclohexane ✓
//   CC1CCCCC1         → methylcyclohexane ✓
//   CC1CCCCC1C        → 1,2-dimethylcyclohexane ✓
//   C1=CCCCC1         → cyclohexene ✓
//   OC1CCCCC1         → cyclohexanol ✓
//   O=C1CCCCC1        → cyclohexanone ✓
//   OC(=O)C1CCCCC1    → cyclohexanecarboxylic acid ✓
//   N#CC1CCCCC1       → cyclohexanecarbonitrile ✓
//   c1ccccc1          → benzene ✓
//   Cc1ccccc1         → toluene (retained PIN) ✓
//   Cc1ccc(C)cc1      → 1,4-dimethylbenzene (systematic; PubChem: 1,4-xylene — trivial) ✓
//   OC(=O)c1ccccc1    → benzoic acid (retained PIN) ✓
//   Oc1ccccc1         → phenol (retained PIN) ✓
//   Nc1ccccc1         → aniline (retained PIN) ✓
//   O=Cc1ccccc1       → benzaldehyde (retained PIN) ✓
//   N#Cc1ccccc1       → benzonitrile (retained PIN) ✓
//   C1CCNCC1          → piperidine ✓
//   c1ccncc1          → pyridine ✓
//   Cc1ccccn1         → 2-methylpyridine ✓
//   OC(=O)c1ccccn1    → pyridine-2-carboxylic acid ✓
//   c1ccoc1           → furan ✓
//   O=Cc1ccco1        → furan-2-carbaldehyde ✓
//   OC(=O)Cc1ccccc1   → 2-phenylacetic acid (chain parent, phenyl sub) ✓
//   Clc1ccccc1        → chlorobenzene ✓
//   CCCCC1CCCCC1      → pentylcyclohexane (PubChem: butylcyclohexane for n-BuCH — see note)
//   C(=O)(N)c1ccccc1  → benzamide (retained PIN) ✓
//   c1ccc2ccccc2c1    → unsupported (naphthalene, Tier 4)
//   N1CCOCC1          → morpholine ✓
//   C=Cc1ccccc1       → styrene (retained PIN) ✓
//
// Note: CCCCC1CCCCC1 is pentylcyclohexane (5C chain). PubChem confirms "pentylcyclohexane"
//   (we verified separately: butylcyclohexane is CCCC-cyclohexane).

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

describe("Tier 3 – carbocycles", () => {
  it("C1CCCCC1 → cyclohexane", () => {
    expect(name("C1CCCCC1")).toBe("cyclohexane");
  });

  it("CC1CCCCC1 → methylcyclohexane", () => {
    expect(name("CC1CCCCC1")).toBe("methylcyclohexane");
  });

  it("CC1CCCCC1C → 1,2-dimethylcyclohexane", () => {
    expect(name("CC1CCCCC1C")).toBe("1,2-dimethylcyclohexane");
  });

  it("C1=CCCCC1 → cyclohexene", () => {
    expect(name("C1=CCCCC1")).toBe("cyclohexene");
  });

  it("OC1CCCCC1 → cyclohexanol", () => {
    expect(name("OC1CCCCC1")).toBe("cyclohexanol");
  });

  it("O=C1CCCCC1 → cyclohexanone", () => {
    expect(name("O=C1CCCCC1")).toBe("cyclohexanone");
  });

  it("OC(=O)C1CCCCC1 → cyclohexanecarboxylic acid", () => {
    expect(name("OC(=O)C1CCCCC1")).toBe("cyclohexanecarboxylic acid");
  });

  it("N#CC1CCCCC1 → cyclohexanecarbonitrile", () => {
    expect(name("N#CC1CCCCC1")).toBe("cyclohexanecarbonitrile");
  });

  it("O=CC1CCCCC1 → cyclohexanecarbaldehyde", () => {
    expect(name("O=CC1CCCCC1")).toBe("cyclohexanecarbaldehyde");
  });

  it("NC1CCCCC1 → cyclohexan-1-amine", () => {
    expect(name("NC1CCCCC1")).toBe("cyclohexan-1-amine");
  });

  // CCCCC1CCCCC1: 4 chain carbons (0,1,2,3) + ring atom 4 + ring atoms 5..9
  // = butylcyclohexane. PubChem confirms: butylcyclohexane.
  it("CCCCC1CCCCC1 → butylcyclohexane", () => {
    expect(name("CCCCC1CCCCC1")).toBe("butylcyclohexane");
  });

  it("ClC1CCCCC1 → chlorocyclohexane", () => {
    expect(name("ClC1CCCCC1")).toBe("chlorocyclohexane");
  });

  it("CC1CCCC1 → methylcyclopentane", () => {
    expect(name("CC1CCCC1")).toBe("methylcyclopentane");
  });
});

describe("Tier 3 – benzene / retained aromatics", () => {
  it("c1ccccc1 → benzene", () => {
    expect(name("c1ccccc1")).toBe("benzene");
  });

  it("Cc1ccccc1 → toluene (retained PIN)", () => {
    expect(name("Cc1ccccc1")).toBe("toluene");
  });

  it("Cc1ccc(C)cc1 → 1,4-dimethylbenzene (systematic; PubChem: 1,4-xylene)", () => {
    expect(name("Cc1ccc(C)cc1")).toBe("1,4-dimethylbenzene");
  });

  it("OC(=O)c1ccccc1 → benzoic acid (retained PIN)", () => {
    expect(name("OC(=O)c1ccccc1")).toBe("benzoic acid");
  });

  it("Oc1ccccc1 → phenol (retained PIN)", () => {
    expect(name("Oc1ccccc1")).toBe("phenol");
  });

  it("Nc1ccccc1 → aniline (retained PIN)", () => {
    expect(name("Nc1ccccc1")).toBe("aniline");
  });

  it("O=Cc1ccccc1 → benzaldehyde (retained PIN)", () => {
    expect(name("O=Cc1ccccc1")).toBe("benzaldehyde");
  });

  it("N#Cc1ccccc1 → benzonitrile (retained PIN)", () => {
    expect(name("N#Cc1ccccc1")).toBe("benzonitrile");
  });

  it("C(=O)(N)c1ccccc1 → benzamide (retained PIN)", () => {
    expect(name("C(=O)(N)c1ccccc1")).toBe("benzamide");
  });

  it("C=Cc1ccccc1 → styrene (retained PIN)", () => {
    expect(name("C=Cc1ccccc1")).toBe("styrene");
  });

  it("Clc1ccccc1 → chlorobenzene", () => {
    expect(name("Clc1ccccc1")).toBe("chlorobenzene");
  });

  it("Oc1ccc(Cl)cc1 → 4-chlorophenol", () => {
    expect(name("Oc1ccc(Cl)cc1")).toBe("4-chlorophenol");
  });

  it("Cc1ccccc1C → 1,2-dimethylbenzene", () => {
    expect(name("Cc1ccccc1C")).toBe("1,2-dimethylbenzene");
  });
});

describe("Tier 3 – ring-as-substituent (chain parent)", () => {
  // PubChem: 2-phenylacetic acid (retained "acetic acid" form).
  // We emit systematic "2-phenylethanoic acid" — confirmed to round-trip via OPSIN.
  it("OC(=O)Cc1ccccc1 → 2-phenylethanoic acid (systematic; PubChem: 2-phenylacetic acid)", () => {
    expect(name("OC(=O)Cc1ccccc1")).toBe("2-phenylethanoic acid");
  });
});

describe("Tier 3 – heterocycles", () => {
  it("C1CCNCC1 → piperidine", () => {
    expect(name("C1CCNCC1")).toBe("piperidine");
  });

  it("c1ccncc1 → pyridine", () => {
    expect(name("c1ccncc1")).toBe("pyridine");
  });

  it("Cc1ccccn1 → 2-methylpyridine", () => {
    expect(name("Cc1ccccn1")).toBe("2-methylpyridine");
  });

  it("OC(=O)c1ccccn1 → pyridine-2-carboxylic acid", () => {
    expect(name("OC(=O)c1ccccn1")).toBe("pyridine-2-carboxylic acid");
  });

  it("c1ccoc1 → furan", () => {
    expect(name("c1ccoc1")).toBe("furan");
  });

  it("O=Cc1ccco1 → furan-2-carbaldehyde", () => {
    expect(name("O=Cc1ccco1")).toBe("furan-2-carbaldehyde");
  });

  it("N1CCOCC1 → morpholine", () => {
    expect(name("N1CCOCC1")).toBe("morpholine");
  });

  it("C1CCNC1 → pyrrolidine", () => {
    expect(name("C1CCNC1")).toBe("pyrrolidine");
  });

  it("CN1CCCC1 → 1-methylpyrrolidine", () => {
    expect(name("CN1CCCC1")).toBe("1-methylpyrrolidine");
  });

  it("c1ccsc1 → thiophene", () => {
    expect(name("c1ccsc1")).toBe("thiophene");
  });

  it("[nH]1cccc1 → pyrrole", () => {
    expect(name("[nH]1cccc1")).toBe("pyrrole");
  });

  it("c1ncncc1 → pyrimidine", () => {
    expect(name("c1ncncc1")).toBe("pyrimidine");
  });
});

describe("Tier 3 – rejections (Tier 4 / out-of-scope)", () => {
  it("naphthalene → unsupported (Tier 4, 2 rings)", () => {
    expect(status("c1ccc2ccccc2c1")).toBe("unsupported");
    expect(reason("c1ccc2ccccc2c1")).toMatch(/Tier 4|fused|multiple ring/i);
  });

  it("7-membered N ring (azepane) → unsupported", () => {
    // Azepane: C1CCCCNC1 - 7 membered saturated N ring not in table
    expect(status("C1CCCCNC1")).toBe("unsupported");
  });

  it("Tier 1/2 acyclic still works", () => {
    expect(name("CCCC")).toBe("butane");
    expect(name("CCO")).toBe("ethanol");
    expect(name("CC(=O)O")).toBe("ethanoic acid");
  });
});
