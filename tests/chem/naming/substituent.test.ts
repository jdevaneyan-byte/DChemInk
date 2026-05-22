import { describe, it, expect } from "vitest";
import { buildCarbonGraph } from "@/chem/naming/chain";
import { nameSubstituent } from "@/chem/naming/substituent";
import type { MolGraph, NamingBond } from "@/chem/naming/graph";

function carbonSkeleton(n: number, bonds: [number, number, 1 | 2 | 3][]): MolGraph {
  const order = new Map<number, number>();
  const nb: NamingBond[] = bonds.map(([f, t, o]) => {
    order.set(f, (order.get(f) ?? 0) + o);
    order.set(t, (order.get(t) ?? 0) + o);
    return { from: f, to: t, order: o, aromatic: false };
  });
  const atoms = Array.from({ length: n }, (_, i) => ({
    index: i, element: "C", charge: 0,
    hydrogens: 4 - (order.get(i) ?? 0), aromatic: false, ringIds: [],
  }));
  return { atoms, bonds: nb, fragmentCount: 1 };
}

describe("nameSubstituent", () => {
  it("names a lone methyl branch", () => {
    // chain C0-C1, branch C2 on C1: name substituent rooted at C2 (fromChain C1)
    const g = carbonSkeleton(3, [[0, 1, 1], [1, 2, 1]]);
    expect(nameSubstituent(buildCarbonGraph(g), 2, 1)).toBe("methyl");
  });

  it("names an isopropyl branch as propan-2-yl", () => {
    // attachment C0; C0 bonded to C1 and C2 (two methyls) -> propan-2-yl
    const g = carbonSkeleton(4, [[3, 0, 1], [0, 1, 1], [0, 2, 1]]);
    // root = C0, fromChain = C3
    expect(nameSubstituent(buildCarbonGraph(g), 0, 3)).toBe("propan-2-yl");
  });

  it("names an isobutyl branch as 2-methylpropyl", () => {
    // attachment CH2 (C0)-CH(C1)(-CH3 C2)(-CH3 C3); fromChain C4
    const g = carbonSkeleton(5, [[4, 0, 1], [0, 1, 1], [1, 2, 1], [1, 3, 1]]);
    expect(nameSubstituent(buildCarbonGraph(g), 0, 4)).toBe("2-methylpropyl");
  });
});
