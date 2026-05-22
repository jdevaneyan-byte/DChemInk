import { describe, it, expect } from "vitest";
import { nameMolecule } from "@/chem/naming/engine";
import type { MolGraph, NamingBond } from "@/chem/naming/graph";

function skeleton(
  elements: string[],
  bonds: [number, number, 1 | 2 | 3][],
  opts: { rings?: number[][]; charges?: Record<number, number>; fragmentCount?: number } = {},
): MolGraph {
  const order = new Map<number, number>();
  const nb: NamingBond[] = bonds.map(([f, t, o]) => {
    order.set(f, (order.get(f) ?? 0) + o);
    order.set(t, (order.get(t) ?? 0) + o);
    return { from: f, to: t, order: o, aromatic: false };
  });
  const ringOf = (i: number) =>
    (opts.rings ?? []).flatMap((r, ri) => (r.includes(i) ? [ri] : []));
  const atoms = elements.map((el, i) => ({
    index: i, element: el, charge: opts.charges?.[i] ?? 0,
    hydrogens: el === "C" ? 4 - (order.get(i) ?? 0) : 0,
    aromatic: false, ringIds: ringOf(i),
  }));
  return { atoms, bonds: nb, fragmentCount: opts.fragmentCount ?? 1 };
}

describe("nameMolecule (Tier 1)", () => {
  const cases: [string, MolGraph, string][] = [
    ["methane", skeleton(["C"], []), "methane"],
    ["propane", skeleton(["C", "C", "C"], [[0, 1, 1], [1, 2, 1]]), "propane"],
    ["2-methylbutane", skeleton(["C", "C", "C", "C", "C"], [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1]]), "2-methylbutane"],
    ["pent-2-ene", skeleton(["C", "C", "C", "C", "C"], [[0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 1]]), "pent-2-ene"],
    ["but-1-yne", skeleton(["C", "C", "C", "C"], [[0, 1, 3], [1, 2, 1], [2, 3, 1]]), "but-1-yne"],
  ];
  it.each(cases)("names %s", (_label, graph, expected) => {
    const r = nameMolecule(graph);
    expect(r.status).toBe("named");
    expect(r.name).toBe(expected);
  });

  it("rejects rings with a Tier-3 reason", () => {
    const benzeneish = skeleton(
      ["C", "C", "C", "C", "C", "C"],
      [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1]],
      { rings: [[0, 1, 2, 3, 4, 5]] },
    );
    const r = nameMolecule(benzeneish);
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/ring/i);
  });

  it("rejects heteroatoms with a Tier-2 reason", () => {
    const r = nameMolecule(skeleton(["C", "O"], [[0, 1, 1]]));
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/oxygen|functional|hetero/i);
  });

  it("rejects multiple fragments", () => {
    const r = nameMolecule(skeleton(["C", "C"], [], { fragmentCount: 2 }));
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/fragment/i);
  });

  it("reports empty input", () => {
    const r = nameMolecule({ atoms: [], bonds: [], fragmentCount: 0 });
    expect(r.status).toBe("empty");
  });
});
