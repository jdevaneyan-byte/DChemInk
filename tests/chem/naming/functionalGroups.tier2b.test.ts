// tests/chem/naming/functionalGroups.tier2b.test.ts
//
// Task 1 — Perception tests for Tier 2b groups:
//   acylHalide, ester, anhydride
//
// PubChem cross-check (2026-05-22):
//   CC(=O)Cl  → "acetyl chloride"      (retained); we assert systematic "ethanoyl chloride"
//   CCC(=O)Br → "propanoyl bromide"    (systematic) ✓
//   CC(=O)OCC → "ethyl acetate"        (retained); we assert systematic "ethyl ethanoate"
//   CC(=O)OC(=O)C → "acetyl acetate"   (PubChem doesn't use anhydride name); we assert systematic "ethanoic anhydride"

import { describe, it, expect } from "vitest";
import { perceiveGroups, principalKind, SENIORITY } from "@/chem/naming/functionalGroups";
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

describe("perceiveGroups — Tier 2b", () => {
  // ── Acyl halide ──────────────────────────────────────────────────────────────
  it("perceives acyl halide in CC(=O)Cl (ethanoyl chloride)", () => {
    // atom 0=C(methyl), 1=C(carbonyl), 2=O(=), 3=Cl
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "Cl", h: 0 }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const fg = p.groups.find((x) => x.kind === "acylHalide");
    expect(fg).toBeDefined();
    expect(fg!.carbon).toBe(1);   // the carbonyl carbon
    expect(fg!.detail).toBe("Cl");
    expect(fg!.atoms).toContain(2); // the =O
    expect(fg!.atoms).toContain(3); // the halogen
  });

  it("perceives acyl halide with F (fluoride)", () => {
    // CF3-group not an acyl halide; test formyl fluoride: H-C(=O)-F  atom0=C(H=1), 1=O(=), 2=F
    // Actually test ethanoyl fluoride CC(=O)F: atom0=C, 1=C(carbonyl), 2=O(=), 3=F
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "F", h: 0 }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const fg = p.groups.find((x) => x.kind === "acylHalide");
    expect(fg).toBeDefined();
    expect(fg!.detail).toBe("F");
  });

  // ── Ester ────────────────────────────────────────────────────────────────────
  it("perceives ester in CC(=O)OCC (ethyl ethanoate)", () => {
    // atom 0=C(methyl), 1=C(carbonyl), 2=O(=), 3=O(ester), 4=C, 5=C
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "O", h: 0 }, { el: "C" }, { el: "C" }],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const fg = p.groups.find((x) => x.kind === "ester");
    expect(fg).toBeDefined();
    expect(fg!.carbon).toBe(1);   // acyl carbon
    expect(fg!.atoms).toContain(2); // =O
    expect(fg!.atoms).toContain(3); // bridging O
  });

  it("perceives ester in CCC(=O)OC (methyl propanoate)", () => {
    // atom 0=C, 1=C, 2=C(carbonyl), 3=O(=), 4=O(ester), 5=C(methyl)
    const g = mol(
      [{ el: "C" }, { el: "C" }, { el: "C" }, { el: "O", h: 0 }, { el: "O", h: 0 }, { el: "C" }],
      [[0, 1, 1], [1, 2, 1], [2, 3, 2], [2, 4, 1], [4, 5, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const fg = p.groups.find((x) => x.kind === "ester");
    expect(fg).toBeDefined();
    expect(fg!.carbon).toBe(2);
  });

  // ── Anhydride ────────────────────────────────────────────────────────────────
  it("perceives anhydride in CC(=O)OC(=O)C (ethanoic anhydride)", () => {
    // atom 0=C(Me), 1=C(carbonyl1), 2=O(=,1), 3=O(bridging), 4=C(carbonyl2), 5=O(=,2), 6=C(Me)
    const g = mol(
      [
        { el: "C" }, { el: "C" }, { el: "O", h: 0 },
        { el: "O", h: 0 },
        { el: "C" }, { el: "O", h: 0 }, { el: "C" },
      ],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 2], [4, 6, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.unsupported).toBeUndefined();
    const fg = p.groups.find((x) => x.kind === "anhydride");
    expect(fg).toBeDefined();
    // carbon = one acyl carbon; detail = second acyl carbon index (stored as string)
    // Both acyl carbons must be either fg.carbon or Number(fg.detail)
    const acylCarbons = new Set([fg!.carbon, Number(fg!.detail)]);
    expect(acylCarbons.has(1)).toBe(true);
    expect(acylCarbons.has(4)).toBe(true);
    // atoms must contain the bridging O and both =O atoms
    expect(fg!.atoms).toContain(3); // bridging O
    expect(fg!.atoms).toContain(2); // =O on carbon1
    expect(fg!.atoms).toContain(5); // =O on carbon2
  });

  it("anhydride is NOT classified as two esters", () => {
    // Same anhydride graph — must not produce two ester groups
    const g = mol(
      [
        { el: "C" }, { el: "C" }, { el: "O", h: 0 },
        { el: "O", h: 0 },
        { el: "C" }, { el: "O", h: 0 }, { el: "C" },
      ],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 2], [4, 6, 1]],
    );
    const p = perceiveGroups(g);
    expect(p.groups.filter((x) => x.kind === "ester")).toHaveLength(0);
    expect(p.groups.filter((x) => x.kind === "anhydride")).toHaveLength(1);
  });

  // ── Seniority ────────────────────────────────────────────────────────────────
  it("seniority: acid(80) > anhydride(75) > ester(70) > acylHalide(65) > amide(60)", () => {
    expect(SENIORITY["acid"]).toBe(80);
    expect(SENIORITY["anhydride"]).toBe(75);
    expect(SENIORITY["ester"]).toBe(70);
    expect(SENIORITY["acylHalide"]).toBe(65);
    expect(SENIORITY["amide"]).toBe(60);
  });

  it("acid is PCG over ester (acid seniority wins)", () => {
    // OC(=O)CC(=O)OC: 3-hydroxy... actually let's build a graph manually:
    // acid group at seniority 80, ester at 70 — acid wins
    const groups = [
      { kind: "ester" as const, carbon: 0, atoms: [] },
      { kind: "acid" as const, carbon: 1, atoms: [] },
    ];
    expect(principalKind(groups)).toBe("acid");
  });

  it("anhydride is PCG over ester", () => {
    const groups = [
      { kind: "ester" as const, carbon: 0, atoms: [] },
      { kind: "anhydride" as const, carbon: 1, atoms: [], detail: "2" },
    ];
    expect(principalKind(groups)).toBe("anhydride");
  });

  it("ester is PCG over acylHalide", () => {
    const groups = [
      { kind: "acylHalide" as const, carbon: 0, atoms: [], detail: "Cl" },
      { kind: "ester" as const, carbon: 1, atoms: [] },
    ];
    expect(principalKind(groups)).toBe("ester");
  });

  it("acylHalide is PCG over amide", () => {
    const groups = [
      { kind: "amide" as const, carbon: 0, atoms: [] },
      { kind: "acylHalide" as const, carbon: 1, atoms: [], detail: "Br" },
    ];
    expect(principalKind(groups)).toBe("acylHalide");
  });
});
