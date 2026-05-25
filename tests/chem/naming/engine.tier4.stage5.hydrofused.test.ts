// tests/chem/naming/engine.tier4.stage5.hydrofused.test.ts
//
// T4 Stage 5 Task 3 — hydrogenated carbocyclic fused systems (naphthalene
// family) via hydro prefixes with fusion-atom letter locants (4a/8a). All names
// PubChem-verified and OPSIN round-trip confirmed. Substituted / indene /
// heteroatom hydro-fused families decline (no wrong names).

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function result(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) throw new Error(`bad smiles ${smiles}`);
  return nameMolecule(g);
}
const name = (s: string) => result(s).name;

describe("T4S5 – hydrogenated naphthalene family (letter locants)", () => {
  it("decalin → decahydronaphthalene", () => {
    expect(name("C1CCC2CCCCC2C1")).toBe("1,2,3,4,4a,5,6,7,8,8a-decahydronaphthalene");
  });
  it("tetralin → 1,2,3,4-tetrahydronaphthalene", () => {
    expect(name("c1ccc2c(c1)CCCC2")).toBe("1,2,3,4-tetrahydronaphthalene");
  });
  it("1,2-dihydronaphthalene", () => {
    expect(name("C1CC=Cc2ccccc21")).toBe("1,2-dihydronaphthalene");
  });
  it("octahydronaphthalene (double bond gets highest locants)", () => {
    expect(name("C1CCC2=CCCCC2C1")).toBe("1,2,3,4,4a,5,6,7-octahydronaphthalene");
  });
  it("naphthalene itself is unaffected", () => {
    expect(name("c1ccc2ccccc2c1")).toBe("naphthalene");
  });
});

describe("T4S5 – hydro-fused out-of-scope declines (no wrong names)", () => {
  it("substituted hydro-fused (2-methyltetralin) declines", () => {
    expect(result("CC1CCc2ccccc2C1").status).toBe("unsupported");
  });
  it("indane (indene family, indicated H) declines", () => {
    expect(result("C1Cc2ccccc2C1").status).toBe("unsupported");
  });
  it("decahydroquinoline (heteroatom hydro-fused) declines", () => {
    expect(result("C1CCC2NCCCC2C1").status).toBe("unsupported");
  });
});
