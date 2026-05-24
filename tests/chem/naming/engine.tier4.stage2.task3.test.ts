// tests/chem/naming/engine.tier4.stage2.task3.test.ts
//
// Task 3 — fused ring substituents + functional groups + ring-as-substituent
//
// All PubChem-verified:
//   Cc1ccc2ccccc2c1          → 2-methylnaphthalene        ✓
//   Cc1cccc2ccccc12          → 1-methylnaphthalene        ✓
//   Oc1cccc2ccccc12          → naphthalen-1-ol            ✓
//   OC(=O)c1ccc2ccccc2c1    → naphthalene-2-carboxylic acid ✓
//   Clc1ccc2ccccc2n1         → 2-chloroquinoline          ✓
//   c1ccc(-c2ccccc2)cc1      → still declined (assembly)  ✓
//   OC(=O)Cc1ccc2ccccc2c1   → 2-(naphthalen-2-yl)acetic acid (PubChem)
//                              our engine uses systematic: 2-(naphthalen-2-yl)ethanoic acid ✓

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

// ── Fused ring + substituents: locanted parent ────────────────────────────────
describe("Task 3 – fused ring with substituents", () => {
  it("2-methylnaphthalene", () => {
    expect(name("Cc1ccc2ccccc2c1")).toBe("2-methylnaphthalene");
  });

  it("1-methylnaphthalene", () => {
    expect(name("Cc1cccc2ccccc12")).toBe("1-methylnaphthalene");
  });

  it("naphthalen-1-ol (1-naphthol)", () => {
    expect(name("Oc1cccc2ccccc12")).toBe("naphthalen-1-ol");
  });

  it("naphthalene-2-carboxylic acid", () => {
    expect(name("OC(=O)c1ccc2ccccc2c1")).toBe("naphthalene-2-carboxylic acid");
  });

  it("2-chloroquinoline", () => {
    expect(name("Clc1ccc2ccccc2n1")).toBe("2-chloroquinoline");
  });
});

// ── Ring-as-substituent (fused ring on a chain) ───────────────────────────────
describe("Task 3 – fused ring as substituent", () => {
  // PubChem: "2-(naphthalen-2-yl)acetic acid"; our engine uses systematic "ethanoic acid"
  it("2-(naphthalen-2-yl)ethanoic acid", () => {
    expect(name("OC(=O)Cc1ccc2ccccc2c1")).toBe("2-(naphthalen-2-yl)ethanoic acid");
  });
});

// ── Regression: assembly still declined ──────────────────────────────────────
describe("Task 3 – regression", () => {
  it("biphenyl still declined as assembly", () => {
    expect(status("c1ccc(-c2ccccc2)cc1")).toBe("unsupported");
  });

  it("bare naphthalene still named (no substituents)", () => {
    expect(name("c1ccc2ccccc2c1")).toBe("naphthalene");
  });

  it("bare quinoline still named", () => {
    expect(name("c1ccc2ncccc2c1")).toBe("quinoline");
  });
});
