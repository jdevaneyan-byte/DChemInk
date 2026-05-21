import { describe, it, expect } from "vitest";
import {
  SPROUT_CODE_TO_SMILES,
  appendSprout,
  insertBondedSprout,
  findAtomEndPosition,
} from "@/hotkeys/sprout";

describe("SPROUT_CODE_TO_SMILES", () => {
  it("maps SPROUT codes to canonical SMILES", () => {
    expect(SPROUT_CODE_TO_SMILES["2"]).toBe("C=O");
    expect(SPROUT_CODE_TO_SMILES["3"]).toBe("c1ccccc1");
    expect(SPROUT_CODE_TO_SMILES["6"]).toBe("C1CCCCC1");
    expect(SPROUT_CODE_TO_SMILES["7"]).toBe("C1CCCC1");
    expect(SPROUT_CODE_TO_SMILES["J"]).toBe("c1ccccc1");
  });
});

describe("appendSprout (no selection / empty canvas path)", () => {
  it("returns the substructure SMILES when canvas is empty", () => {
    expect(appendSprout("", "3")).toBe("c1ccccc1");
    expect(appendSprout("   ", "6")).toBe("C1CCCCC1");
  });

  it("appends the substructure as a separate fragment when canvas has content", () => {
    expect(appendSprout("CCO", "3")).toBe("CCO.c1ccccc1");
  });

  it("returns null for unknown codes", () => {
    expect(appendSprout("CCO", "99")).toBeNull();
  });
});

describe("findAtomEndPosition", () => {
  it("finds the position right after the first atom in a linear chain", () => {
    expect(findAtomEndPosition("CCCC", 0)).toBe(1);
    expect(findAtomEndPosition("CCCC", 3)).toBe(4);
  });

  it("handles aromatic lowercase atoms past their ring-closure digit", () => {
    // c1ccccc1: pos 0='c'(atom0), 1='1', 2='c'(atom1), ...
    // Atom 0 ends after consuming the ring digit, i.e. at position 2.
    expect(findAtomEndPosition("c1ccccc1", 0)).toBe(2);
  });

  it("handles two-letter elements (Cl, Br)", () => {
    expect(findAtomEndPosition("CCl", 0)).toBe(1);
    expect(findAtomEndPosition("CCl", 1)).toBe(3); // past 'Cl'
    expect(findAtomEndPosition("CBr", 1)).toBe(3);
  });

  it("handles bracketed atoms", () => {
    expect(findAtomEndPosition("[NH4+]", 0)).toBe(6);
    expect(findAtomEndPosition("C[NH4+]", 1)).toBe(7);
  });

  it("returns -1 if atomIdx is out of range", () => {
    expect(findAtomEndPosition("CC", 5)).toBe(-1);
  });
});

describe("insertBondedSprout", () => {
  it("attaches carbonyl to terminal carbon of ethane", () => {
    // CC + carbonyl on atom 1 → CC(=O) ie acetaldehyde (Kekulé)
    expect(insertBondedSprout("CC", 1, "C=O")).toBe("CC(C=O)");
  });

  it("attaches benzene to a methane carbon → toluene SMILES", () => {
    // C + benzene on atom 0 → C(c1ccccc1) ≡ toluene
    expect(insertBondedSprout("C", 0, "c1ccccc1")).toBe("C(c1ccccc1)");
  });

  it("attaches at the middle of a chain", () => {
    // CCCC + cyclohexane on atom 1 → CC(C1CCCCC1)CC
    expect(insertBondedSprout("CCCC", 1, "C1CCCCC1")).toBe("CC(C1CCCCC1)CC");
  });

  it("attaches past a ring closure digit", () => {
    // c1ccccc1 + Me on atom 0 → c1(C)ccccc1 — branch comes after the ring closure
    expect(insertBondedSprout("c1ccccc1", 0, "C")).toBe("c1(C)ccccc1");
  });

  it("returns null when atomIdx is out of range", () => {
    expect(insertBondedSprout("CC", 5, "C=O")).toBeNull();
  });
});
