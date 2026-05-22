import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

describe("graphFromSmiles", () => {
  it("builds a 4-carbon acyclic graph for butane", () => {
    const g = graphFromSmiles("CCCC")!;
    expect(g).not.toBeNull();
    expect(g.atoms.filter((a) => a.element === "C")).toHaveLength(4);
    expect(g.atoms.every((a) => a.ringIds.length === 0)).toBe(true);
    expect(g.fragmentCount).toBe(1);
  });

  it("carries the double bond order for propene", () => {
    const g = graphFromSmiles("CC=C")!;
    expect(g.bonds.some((b) => b.order === 2)).toBe(true);
  });

  it("marks ring atoms for cyclohexane", () => {
    const g = graphFromSmiles("C1CCCCC1")!;
    expect(g.atoms.some((a) => a.ringIds.length > 0)).toBe(true);
  });

  it("reports two fragments for a salt-like input", () => {
    const g = graphFromSmiles("CC.CC")!;
    expect(g.fragmentCount).toBe(2);
  });

  it("returns null for invalid SMILES", () => {
    expect(graphFromSmiles("not-a-smiles")).toBeNull();
  });
});
