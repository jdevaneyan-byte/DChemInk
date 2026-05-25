// tests/chem/naming/engine.nitro.test.ts
//
// Coverage class: nitro compounds. RDKit writes nitro in its charged Kekulé form
// [O-][N+]=O, which the top-level charge guard previously rejected wholesale.
// Net-neutral nitro molecules now name (nitro prefix); other charged species
// (ammonium, carboxylate salts) still decline. PubChem-verified.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});
const name = (s: string) => { const g = graphFromSmiles(s); return g ? nameMolecule(g).name : null; };
const status = (s: string) => { const g = graphFromSmiles(s); return g ? nameMolecule(g).status : null; };

describe("nitro compounds name (PubChem-verified)", () => {
  it("nitrobenzene", () => expect(name("[O-][N+](=O)c1ccccc1")).toBe("nitrobenzene"));
  it("nitroethane", () => expect(name("CC[N+](=O)[O-]")).toBe("nitroethane"));
  it("1-nitropropane", () => expect(name("[O-][N+](=O)CCC")).toBe("1-nitropropane"));
  it("1-methyl-4-nitrobenzene", () => expect(name("O=[N+]([O-])c1ccc(C)cc1")).toBe("1-methyl-4-nitrobenzene"));
  it("1,2-dinitroethane", () => expect(name("[O-][N+](=O)CC[N+](=O)[O-]")).toBe("1,2-dinitroethane"));
});

describe("other charged species still decline (no wrong names)", () => {
  it("tetramethylammonium declines", () => expect(status("C[N+](C)(C)C")).toBe("unsupported"));
  it("acetate (carboxylate salt) declines", () => expect(status("CC(=O)[O-]")).toBe("unsupported"));
});
