import { describe, it, expect } from "vitest";
import { buildCarbonGraph, longestCarbonChains, ccOrder, selectPrincipalChain, allCarbonChains } from "@/chem/naming/chain";
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

// ── Tier-2: PCG-aware chain selection ───────────────────────────────────────────
describe("allCarbonChains", () => {
  it("returns all paths (not just longest) for a 3-carbon chain", () => {
    // C0-C1-C2 has one path between each pair: (0,1), (1,2), (0,2)
    const g = carbonSkeleton(3, [[0, 1, 1], [1, 2, 1]]);
    const chains = allCarbonChains(buildCarbonGraph(g));
    // 3 unique unordered pairs → 3 paths
    expect(chains.length).toBeGreaterThanOrEqual(3);
    // The longest is 3 carbons
    expect(Math.max(...chains.map((c) => c.length))).toBe(3);
  });
});

describe("selectPrincipalChain with PCG", () => {
  // pentan-2-ol: C0-C1-C2-C3-C4, OH on C1 (pcgCarbon=1)
  // Numbering from C0 end: OH is at position 2 (locant 2).
  // Numbering from C4 end: OH is at position 4.
  // PCG priority → locant 2 wins → chain numbered from C0.
  it("numbers pentan-2-ol so OH gets locant 2 not 4", () => {
    // 5 carbons C0..C4; PCG carbon = C1 (OH attached there)
    const g = carbonSkeleton(5, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1]]);
    const cg = buildCarbonGraph(g);
    const chosen = selectPrincipalChain(cg, { pcgCarbons: [1] });
    // C1 must appear at locant 2 in the chosen direction
    const locant = chosen.atoms.indexOf(1) + 1;
    expect(locant).toBe(2);
  });

  // When PCG carbon is only in a shorter sub-chain but not the longest chain,
  // IUPAC requires the PCG-bearing chain. Test: 2-methylbutan-1-ol where OH is
  // on C0 (terminal), main chain 4 long, PCG carbon = C0.
  // Actually all 4-long chains contain C0 here, so just a regression check.
  it("still picks the longest chain when all contain the PCG carbon", () => {
    // C0-C1(-C4)-C2-C3, pcgCarbon=C0
    const g = carbonSkeleton(5, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1]]);
    const cg = buildCarbonGraph(g);
    const chosen = selectPrincipalChain(cg, { pcgCarbons: [0] });
    // The chosen chain must be length 4 and contain C0
    expect(chosen.atoms.length).toBe(4);
    expect(chosen.atoms).toContain(0);
  });

  // Regression: no PCG should behave identically to Tier 1
  it("with no PCG, behavior is identical to Tier-1 (2-methylbutane example)", () => {
    const g = carbonSkeleton(5, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1]]);
    const cg = buildCarbonGraph(g);
    const tier1 = selectPrincipalChain(cg);
    const tier2 = selectPrincipalChain(cg, { pcgCarbons: [] });
    expect(tier2.atoms).toEqual(tier1.atoms);
  });
});
