// tests/chem/naming/ring.numbering.test.ts
// Task 2 – TDD: ring tables (carbocycle/benzene/heterocycle) + numbering
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { perceiveRing, nameRing } from "@/chem/naming/ring";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function nr(smiles: string, opts: Parameters<typeof nameRing>[2] = {}) {
  const g = graphFromSmiles(smiles)!;
  const ring = perceiveRing(g)!;
  return nameRing(g, ring, opts);
}

describe("nameRing - carbocycles", () => {
  it("cyclohexane → parent='cyclohexane', kind='carbocycle'", () => {
    const r = nr("C1CCCCC1");
    expect(r).not.toBeNull();
    expect(r!.parent).toBe("cyclohexane");
    expect(r!.kind).toBe("carbocycle");
    expect(r!.locantOf.size).toBe(6);
  });

  it("cyclopropane → 'cyclopropane'", () => {
    expect(nr("C1CC1")!.parent).toBe("cyclopropane");
  });

  it("cyclobutane → 'cyclobutane'", () => {
    expect(nr("C1CCC1")!.parent).toBe("cyclobutane");
  });

  it("cyclopentane → 'cyclopentane'", () => {
    expect(nr("C1CCCC1")!.parent).toBe("cyclopentane");
  });

  it("cycloheptane → 'cycloheptane'", () => {
    expect(nr("C1CCCCCC1")!.parent).toBe("cycloheptane");
  });

  it("locants cover all ring atoms, assigned 1..n", () => {
    const g = graphFromSmiles("C1CCCCC1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    const locs = [...r.locantOf.values()].sort((a, b) => a - b);
    expect(locs).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("nameRing - benzene", () => {
  it("benzene → parent='benzene', kind='benzene'", () => {
    const r = nr("c1ccccc1");
    expect(r).not.toBeNull();
    expect(r!.parent).toBe("benzene");
    expect(r!.kind).toBe("benzene");
  });

  it("methylbenzene: locants still 1..6", () => {
    const g = graphFromSmiles("Cc1ccccc1")!;
    const ring = perceiveRing(g)!;
    // ring only contains the 6 aromatic ring atoms, not the methyl C
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("benzene");
    const locs = [...r.locantOf.values()].sort((a, b) => a - b);
    expect(locs).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("nameRing - heterocycles", () => {
  it("pyridine → 'pyridine', N gets locant 1", () => {
    const g = graphFromSmiles("c1ccncc1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("pyridine");
    expect(r.kind).toBe("heterocycle");
    // The N atom should be at locant 1
    const nAtom = g.atoms.find(a => a.element === "N" && ring.atoms.includes(a.index))!;
    expect(r.locantOf.get(nAtom.index)).toBe(1);
  });

  it("furan → 'furan', O gets locant 1", () => {
    const g = graphFromSmiles("c1ccoc1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("furan");
    const oAtom = g.atoms.find(a => a.element === "O" && ring.atoms.includes(a.index))!;
    expect(r.locantOf.get(oAtom.index)).toBe(1);
  });

  it("thiophene → 'thiophene', S gets locant 1", () => {
    const g = graphFromSmiles("c1ccsc1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("thiophene");
    const sAtom = g.atoms.find(a => a.element === "S" && ring.atoms.includes(a.index))!;
    expect(r.locantOf.get(sAtom.index)).toBe(1);
  });

  it("pyrrole → 'pyrrole', N gets locant 1", () => {
    const g = graphFromSmiles("c1ccnc1")!; // or [nH]1cccc1
    // Use explicit NH form
    const g2 = graphFromSmiles("[nH]1cccc1")!;
    const ring = perceiveRing(g2)!;
    const r = nameRing(g2, ring)!;
    expect(r.parent).toBe("pyrrole");
    const nAtom = g2.atoms.find(a => a.element === "N" && ring.atoms.includes(a.index))!;
    expect(r.locantOf.get(nAtom.index)).toBe(1);
  });

  it("piperidine → 'piperidine', N gets locant 1", () => {
    const g = graphFromSmiles("C1CCNCC1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("piperidine");
    const nAtom = g.atoms.find(a => a.element === "N" && ring.atoms.includes(a.index))!;
    expect(r.locantOf.get(nAtom.index)).toBe(1);
  });

  it("morpholine → 'morpholine'", () => {
    const r = nr("C1COCCN1");
    expect(r!.parent).toBe("morpholine");
  });

  it("pyrrolidine → 'pyrrolidine'", () => {
    const r = nr("C1CCNC1");
    expect(r!.parent).toBe("pyrrolidine");
  });

  it("oxolane → 'oxolane'", () => {
    const r = nr("C1CCOC1");
    expect(r!.parent).toBe("oxolane");
  });

  it("pyrimidine → 'pyrimidine', both N at 1+3", () => {
    // pyrimidine = 1,3-diazine; N at 1 and 3 (one C between them)
    // SMILES: c1ncncc1 (N at index 1 and 3 = adjacent-to-two-N-pattern N-C-N)
    const g = graphFromSmiles("c1ncncc1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("pyrimidine");
    // N atoms should have locants 1 and 3
    const nAtoms = g.atoms.filter(a => a.element === "N" && ring.atoms.includes(a.index));
    const nLocs = nAtoms.map(a => r.locantOf.get(a.index)!).sort((a,b)=>a-b);
    expect(nLocs).toEqual([1, 3]);
  });

  it("pyrazine → 'pyrazine', both N at 1+4 (c1cnccn1)", () => {
    const g = graphFromSmiles("c1cnccn1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("pyrazine");
    const nAtoms = g.atoms.filter(a => a.element === "N" && ring.atoms.includes(a.index));
    const nLocs = nAtoms.map(a => r.locantOf.get(a.index)!).sort((a,b)=>a-b);
    expect(nLocs).toEqual([1, 4]);
  });

  it("piperazine → 'piperazine', N at 1,4", () => {
    const g = graphFromSmiles("C1CNCCN1")!;
    const ring = perceiveRing(g)!;
    const r = nameRing(g, ring)!;
    expect(r.parent).toBe("piperazine");
    const nAtoms = g.atoms.filter(a => a.element === "N" && ring.atoms.includes(a.index));
    const nLocs = nAtoms.map(a => r.locantOf.get(a.index)!).sort((a,b)=>a-b);
    expect(nLocs).toEqual([1, 4]);
  });

  it("non-tabled heterocycle returns null", () => {
    // Azepine: 7-membered ring with one N
    const g = graphFromSmiles("C1=CC=CC=CN1")!;
    const ring = perceiveRing(g);
    if (!ring) return; // if not perceived, that's fine
    const r = nameRing(g, ring);
    expect(r).toBeNull(); // not in table
  });
});

describe("nameRing - locant direction for substituents", () => {
  it("1,2 vs 1,6 for dimethylcyclohexane: picks direction giving lower set", () => {
    // 1,2-dimethylcyclohexane: the two methyls are on adjacent ring atoms
    // The direction that gives {2} not {6} should be chosen
    const g = graphFromSmiles("CC1CCCCC1C")!;
    const ring = perceiveRing(g)!;
    // Find the two substituted ring atoms
    const ringSet = new Set(ring.atoms);
    const subs = ring.atoms.filter(idx => {
      // Has a non-ring non-H neighbor
      return g.bonds.some(b => {
        const other = b.from === idx ? b.to : b.to === idx ? b.from : -1;
        return other !== -1 && !ringSet.has(other) && g.atoms.find(a => a.index === other)?.element !== "H";
      });
    });
    const subSet = new Set(subs);
    const r = nameRing(g, ring, { subAtoms: subSet })!;
    const subLocs = subs.map(idx => r.locantOf.get(idx)!).sort((a,b)=>a-b);
    // Should give [1,2] not [1,6]
    expect(subLocs).toEqual([1, 2]);
  });
});
