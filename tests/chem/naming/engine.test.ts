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

  it("rejects a cyclic carbon graph even without ring metadata", () => {
    // 6-membered carbocycle, but ringIds intentionally omitted (rings: []).
    const cyclohexaneNoRings = skeleton(
      ["C", "C", "C", "C", "C", "C"],
      [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1]],
    );
    const r = nameMolecule(cyclohexaneNoRings);
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

  it("parenthesizes a complex (isobutyl) substituent", () => {
    // Nonane C0..C8; isobutyl (2-methylpropyl) at the central C4 (locant 5):
    // C4-C9(H2)-C10(H)(-C11 methyl)(-C12 methyl). The 9-carbon chain is the
    // unique longest chain, so the branch must be named as a substituent.
    const g = skeleton(
      ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      [
        [0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 6, 1],
        [6, 7, 1], [7, 8, 1], [4, 9, 1], [9, 10, 1], [10, 11, 1], [10, 12, 1],
      ],
    );
    const r = nameMolecule(g);
    expect(r.status).toBe("named");
    expect(r.name).toBe("5-(2-methylpropyl)nonane");
  });

  it("breaks a numbering tie toward the alphabetically-first substituent", () => {
    // Hexane C0..C5, methyl (C6) on C2, ethyl (C7-C8) on C3. Locant sets tie
    // in both directions ({3,4}); ethyl ('e' < 'm') must get the lower locant 3.
    // Numbering forward (C0..C5) would give methyl=3, so this only resolves
    // correctly with the alphabetical tie-break.
    const g = skeleton(
      ["C", "C", "C", "C", "C", "C", "C", "C", "C"],
      [
        [0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1],
        [2, 6, 1], [3, 7, 1], [7, 8, 1],
      ],
    );
    const r = nameMolecule(g);
    expect(r.status).toBe("named");
    expect(r.name).toBe("3-ethyl-4-methylhexane");
  });

  it("parenthesizes an isopropyl (propan-2-yl) substituent", () => {
    // Nonane C0..C8; isopropyl at the central C4 (locant 5):
    // C4-C9(H)(-C10 methyl)(-C11 methyl)  => propan-2-yl
    const g = skeleton(
      ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      [
        [0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 6, 1],
        [6, 7, 1], [7, 8, 1], [4, 9, 1], [9, 10, 1], [9, 11, 1],
      ],
    );
    const r = nameMolecule(g);
    expect(r.status).toBe("named");
    expect(r.name).toContain("(propan-2-yl)");
  });
});
