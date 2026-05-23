// tests/chem/naming/ring.test.ts
// Task 1 – TDD: ring perception + canonical fingerprint
// Step 1: FAILING tests (before ring.ts exists)
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { perceiveRing, ringFingerprint } from "@/chem/naming/ring";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function g(smiles: string) {
  const graph = graphFromSmiles(smiles);
  if (!graph) throw new Error(`graphFromSmiles returned null for ${smiles}`);
  return graph;
}

describe("perceiveRing", () => {
  it("cyclohexane: 6-membered all-carbon non-aromatic ring", () => {
    const ring = perceiveRing(g("C1CCCCC1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(6);
    expect(ring!.aromatic).toBe(false);
    expect(ring!.heteroatoms).toHaveLength(0);
    expect(ring!.atoms).toHaveLength(6);
  });

  it("cyclopropane: 3-membered ring", () => {
    const ring = perceiveRing(g("C1CC1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(3);
    expect(ring!.aromatic).toBe(false);
  });

  it("cyclopentane: 5-membered ring", () => {
    const ring = perceiveRing(g("C1CCCC1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(5);
  });

  it("benzene: aromatic 6-membered all-carbon ring", () => {
    const ring = perceiveRing(g("c1ccccc1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(6);
    expect(ring!.aromatic).toBe(true);
    expect(ring!.heteroatoms).toHaveLength(0);
  });

  it("pyridine: aromatic ring with 1 N heteroatom", () => {
    const ring = perceiveRing(g("c1ccncc1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(6);
    expect(ring!.aromatic).toBe(true);
    expect(ring!.heteroatoms).toHaveLength(1);
  });

  it("piperidine: saturated ring with 1 N heteroatom", () => {
    const ring = perceiveRing(g("C1CCNCC1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(6);
    expect(ring!.aromatic).toBe(false);
    expect(ring!.heteroatoms).toHaveLength(1);
  });

  it("furan: aromatic ring with 1 O heteroatom", () => {
    const ring = perceiveRing(g("c1ccoc1"));
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(5);
    expect(ring!.aromatic).toBe(true);
    expect(ring!.heteroatoms).toHaveLength(1);
  });

  it("naphthalene (2 rings): returns null", () => {
    expect(perceiveRing(g("c1ccc2ccccc2c1"))).toBeNull();
  });

  it("decalin (2 rings): returns null", () => {
    expect(perceiveRing(g("C1CCC2CCCCC2C1"))).toBeNull();
  });

  it("methane (no ring): returns null", () => {
    expect(perceiveRing(g("C"))).toBeNull();
  });

  it("ring atoms are a subset of all atoms and form a cycle", () => {
    const graph = g("C1CCCCC1");
    const ring = perceiveRing(graph)!;
    // All ring-atom indices should be valid heavy atom indices in the graph
    const atomSet = new Set(graph.atoms.filter(a => a.element !== "H").map(a => a.index));
    for (const a of ring.atoms) {
      expect(atomSet.has(a)).toBe(true);
    }
  });
});

describe("ringFingerprint", () => {
  it("produces stable result independent of atom-index ordering for pyridine", () => {
    // Two SMILES that produce the same ring but different atom indices
    const fp1 = ringFingerprint(g("c1ccncc1"), perceiveRing(g("c1ccncc1"))!);
    const fp2 = ringFingerprint(g("c1ccccn1"), perceiveRing(g("c1ccccn1"))!);
    expect(fp1).toBe(fp2);
  });

  it("cyclohexane fingerprint differs from benzene", () => {
    const fpHex = ringFingerprint(g("C1CCCCC1"), perceiveRing(g("C1CCCCC1"))!);
    const fpBenz = ringFingerprint(g("c1ccccc1"), perceiveRing(g("c1ccccc1"))!);
    expect(fpHex).not.toBe(fpBenz);
  });

  it("pyridine fingerprint differs from benzene", () => {
    const fpPyr = ringFingerprint(g("c1ccncc1"), perceiveRing(g("c1ccncc1"))!);
    const fpBenz = ringFingerprint(g("c1ccccc1"), perceiveRing(g("c1ccccc1"))!);
    expect(fpPyr).not.toBe(fpBenz);
  });

  it("cyclohexane fingerprint same regardless of substituents", () => {
    // methylcyclohexane vs cyclohexane should produce the same ring fingerprint
    const fp1 = ringFingerprint(g("C1CCCCC1"), perceiveRing(g("C1CCCCC1"))!);
    const fp2 = ringFingerprint(g("CC1CCCCC1"), perceiveRing(g("CC1CCCCC1"))!);
    expect(fp1).toBe(fp2);
  });
});
