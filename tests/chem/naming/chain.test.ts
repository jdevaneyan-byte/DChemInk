import { describe, it, expect } from "vitest";
import { buildCarbonGraph, longestCarbonChains, ccOrder, selectPrincipalChain } from "@/chem/naming/chain";
import type { MolGraph, NamingBond } from "@/chem/naming/graph";

/** n carbons, bonds = [from,to,order]. Hydrogens filled to valence 4. */
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

describe("longestCarbonChains", () => {
  it("returns the single chain for n-butane", () => {
    const g = carbonSkeleton(4, [[0, 1, 1], [1, 2, 1], [2, 3, 1]]);
    const chains = longestCarbonChains(buildCarbonGraph(g));
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(4);
  });

  it("returns the 4-long chains of 2-methylbutane (isopentane)", () => {
    // C0-C1(-C4)-C2-C3 : longest = 4 carbons
    const g = carbonSkeleton(5, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1]]);
    const chains = longestCarbonChains(buildCarbonGraph(g));
    expect(Math.max(...chains.map((c) => c.length))).toBe(4);
  });

  it("reads C–C bond order", () => {
    const g = carbonSkeleton(2, [[0, 1, 2]]);
    expect(ccOrder(buildCarbonGraph(g), 0, 1)).toBe(2);
  });
});

describe("selectPrincipalChain", () => {
  it("numbers pent-2-ene so the double bond gets the lower locant", () => {
    // C0=C1-C2-C3-C4 has the double bond at 0-1; numbering from C4 end -> locant 2? No.
    // Build pent-2-ene: C0-C1=C2-C3-C4 (double between 1,2).
    const g = carbonSkeleton(5, [[0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 1]]);
    const chosen = selectPrincipalChain(buildCarbonGraph(g));
    // Direction chosen so the ene locant is 2 (lower) not 3.
    const idx = chosen.atoms;
    const dbPos = idx.findIndex((a, i) => i < idx.length - 1 &&
      ccOrder(buildCarbonGraph(g), a, idx[i + 1]) === 2);
    expect(dbPos + 1).toBe(2);
  });

  it("picks lowest substituent locant for 2-methylbutane", () => {
    // C0-C1(-C4)-C2-C3, methyl on C1. Main chain C0..C3; number so methyl=2.
    const g = carbonSkeleton(5, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1]]);
    const chosen = selectPrincipalChain(buildCarbonGraph(g));
    const inChain = new Set(chosen.atoms);
    // the off-chain carbon (4) attaches to chosen.atoms[idx]; that locant must be 2
    const attachIdx = chosen.atoms.findIndex(
      (a) => (buildCarbonGraph(g).adj.get(a) ?? []).some((nb) => !inChain.has(nb)),
    );
    expect(attachIdx + 1).toBe(2);
  });
});
