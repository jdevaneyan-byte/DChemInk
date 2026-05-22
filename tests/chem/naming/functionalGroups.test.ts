// tests/chem/naming/functionalGroups.test.ts
import { describe, it, expect } from "vitest";
import { perceiveGroups, principalKind } from "@/chem/naming/functionalGroups";
import type { MolGraph, NamingAtom, NamingBond } from "@/chem/naming/graph";

/**
 * Build a MolGraph from an explicit atom+bond spec.
 * hydrogens: for heteroatoms specify explicitly; for C auto-compute from valence.
 */
function mol(
  atoms: { el: string; charge?: number; h?: number }[],
  bonds: [number, number, 1 | 2 | 3][],
): MolGraph {
  const valence = new Map<number, number>();
  const nb: NamingBond[] = bonds.map(([f, t, o]) => {
    valence.set(f, (valence.get(f) ?? 0) + o);
    valence.set(t, (valence.get(t) ?? 0) + o);
    return { from: f, to: t, order: o, aromatic: false };
  });
  const na: NamingAtom[] = atoms.map((a, i) => ({
    index: i,
    element: a.el,
    charge: a.charge ?? 0,
    hydrogens: a.h !== undefined ? a.h : a.el === "C" ? 4 - (valence.get(i) ?? 0) : 0,
    aromatic: false,
    ringIds: [],
  }));
  return { atoms: na, bonds: nb, fragmentCount: 1 };
}

describe("perceiveGroups", () => {
  // ── Carboxylic acid ──────────────────────────────────────────────────────────
  it("detects acid in CC(=O)O (ethanoic acid)", () => {
    // atom 0=C(methyl), 1=C(carbonyl), 2=O(double), 3=O(single,H)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "O", h: 1 }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    expect(p.groups.filter((x) => x.kind === "acid")).toHaveLength(1);
    expect(p.groups.find((x) => x.kind === "acid")?.carbon).toBe(1);
  });

  // ── Ketone ───────────────────────────────────────────────────────────────────
  it("detects ketone in CC(=O)C (propan-2-one)", () => {
    // 0=C, 1=C(carbonyl), 2=O(=), 3=C
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "C" }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    expect(p.groups.find((x) => x.kind === "ketone")?.carbon).toBe(1);
  });

  // ── Aldehyde ─────────────────────────────────────────────────────────────────
  it("detects aldehyde in CC=O (ethanal)", () => {
    // 0=C(methyl), 1=C(carbonyl,H=1), 2=O(=)
    const g = mol(
      [{ el: "C" }, { el: "C", h: 1 }, { el: "O", h: 0 }],
      [[0, 1, 1], [1, 2, 2]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    expect(p.groups.find((x) => x.kind === "aldehyde")?.carbon).toBe(1);
  });

  // ── Nitrile ──────────────────────────────────────────────────────────────────
  it("detects nitrile in CC#N (ethanenitrile)", () => {
    // 0=C(methyl), 1=C(nitrile), 2=N(triple)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "N", h: 0 }],
      [[0, 1, 1], [1, 2, 3]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    expect(p.groups.find((x) => x.kind === "nitrile")?.carbon).toBe(1);
  });

  // ── Alcohol ───────────────────────────────────────────────────────────────────
  it("detects alcohol in CCO (ethanol)", () => {
    // 0=C(ethyl), 1=C, 2=O(H=1)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 1 }],
      [[0, 1, 1], [1, 2, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const alc = p.groups.find((x) => x.kind === "alcohol");
    expect(alc).toBeDefined();
    expect(alc!.carbon).toBe(1); // the C attached to OH
  });

  // ── Amine ─────────────────────────────────────────────────────────────────────
  it("detects amine in CCN (ethanamine)", () => {
    // 0=C, 1=C, 2=N(H=2)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "N", h: 2 }],
      [[0, 1, 1], [1, 2, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const amine = p.groups.find((x) => x.kind === "amine");
    expect(amine).toBeDefined();
    expect(amine!.carbon).toBe(1);
  });

  // ── Amide ─────────────────────────────────────────────────────────────────────
  it("detects amide in CC(=O)N (ethanamide)", () => {
    // 0=C, 1=C(carbonyl), 2=O(=), 3=N(H=2)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "N", h: 2 }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    expect(p.groups.find((x) => x.kind === "amide")?.carbon).toBe(1);
  });

  // ── Halide ─────────────────────────────────────────────────────────────────────
  it("detects chloro halide in CCCl (chloroethane)", () => {
    // 0=C, 1=C, 2=Cl
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "Cl", h: 0 }],
      [[0, 1, 1], [1, 2, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const hal = p.groups.find((x) => x.kind === "halide");
    expect(hal).toBeDefined();
    expect(hal!.detail).toBe("Cl");
    expect(hal!.carbon).toBe(1);
  });

  // ── Ether ─────────────────────────────────────────────────────────────────────
  it("detects ether in COC (methoxymethane)", () => {
    // 0=C, 1=O(ether), 2=C
    const g = mol(
      [{ el: "C" }, { el: "O", h: 0 }, { el: "C" }],
      [[0, 1, 1], [1, 2, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    expect(p.groups.find((x) => x.kind === "ether")).toBeDefined();
  });

  // ── Mixed seniority ──────────────────────────────────────────────────────────
  it("selects acid as PCG when both -OH and -COOH present", () => {
    // OCC(=O)O: atom0=O(H), atom1=C, atom2=C(carbonyl), atom3=O(=), atom4=O(H)
    const g = mol(
      [{ el: "O", h: 1 }, { el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "O", h: 1 }],
      [[0, 1, 1], [1, 2, 1], [2, 3, 2], [2, 4, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    // must have both alcohol and acid
    expect(p.groups.map((x) => x.kind)).toContain("alcohol");
    expect(p.groups.map((x) => x.kind)).toContain("acid");
    expect(principalKind(p.groups)).toBe("acid");
  });

  // ── Ester rejection ──────────────────────────────────────────────────────────
  it("marks ester CC(=O)OC as unsupported (T2b)", () => {
    // 0=C(methyl), 1=C(carbonyl), 2=O(=), 3=O(ester-O), 4=C(methyl)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "O", h: 0 }, { el: "C" }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toMatch(/ester|T2b/i);
  });
});

describe("principalKind", () => {
  it("returns null for an empty group list", () => {
    expect(principalKind([])).toBeNull();
  });

  it("returns null when only prefix-only groups present", () => {
    // halide has seniority 0
    const g = mol(
      [{ el: "C" }, { el: "Cl", h: 0 }],
      [[0, 1, 1]],
    );
    const p = perceiveGroups(g);
    expect(principalKind(p.groups)).toBeNull();
  });

  it("picks acid over alcohol (higher seniority)", () => {
    // acid group: seniority 80 > alcohol: 20
    const groups = [
      { kind: "alcohol" as const, carbon: 0, atoms: [] },
      { kind: "acid" as const, carbon: 1, atoms: [] },
    ];
    expect(principalKind(groups)).toBe("acid");
  });

  it("picks ketone over amine", () => {
    const groups = [
      { kind: "amine" as const, carbon: 0, atoms: [] },
      { kind: "ketone" as const, carbon: 1, atoms: [] },
    ];
    expect(principalKind(groups)).toBe("ketone");
  });
});
