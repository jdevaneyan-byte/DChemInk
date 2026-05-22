// tests/chem/naming/assemble.tier2b.test.ts
//
// Task 2 — Unit tests for the two-part name builders: acylName, acylHalideName,
// esterName, anhydrideName.
//
// PubChem cross-check results (2026-05-22):
//   ethanoyl chloride      → PubChem: "acetyl chloride"     (retained); we assert systematic
//   propanoyl bromide      → PubChem: "propanoyl bromide"   (systematic) ✓
//   ethyl ethanoate        → PubChem: "ethyl acetate"       (retained); we assert systematic
//   methyl propanoate      → PubChem: "methyl propanoate"   (systematic) ✓
//   propan-2-yl ethanoate  → PubChem: "propan-2-yl acetate" (retained); we assert systematic
//   methyl prop-2-enoate   → PubChem: "methyl prop-2-enoate"(systematic) ✓
//   ethanoic anhydride     → PubChem: "acetyl acetate"      (different IUPAC form); we assert systematic
//   ethanoic propanoic anhydride → PubChem: "acetyl propanoate"; we assert systematic

import { describe, it, expect } from "vitest";
import { acylName, acylHalideName, esterName, anhydrideName } from "@/chem/naming/assemble";

describe("acylName", () => {
  it("ethanoyl (2C, no unsaturation)", () => {
    expect(acylName(2, [], [], [])).toBe("ethanoyl");
  });

  it("propanoyl (3C, no unsaturation)", () => {
    expect(acylName(3, [], [], [])).toBe("propanoyl");
  });

  it("butanoyl (4C, no unsaturation)", () => {
    expect(acylName(4, [], [], [])).toBe("butanoyl");
  });

  it("methanoyl (1C — formyl)", () => {
    expect(acylName(1, [], [], [])).toBe("methanoyl");
  });

  it("prop-2-enoyl (3C, double at position 2)", () => {
    // prop-2-enoyl: propan → e-elision → prop + -2-en + -oyl (from prop-2-ene → e-elision → prop-2-en-oyl)
    // Actually the logic: stem=prop, ending gives prop-2-ene, then replace 'ane'/'ene' with '-oyl'
    expect(acylName(3, [2], [], [])).toBe("prop-2-enoyl");
  });

  it("but-2-enoyl (4C, double at position 2)", () => {
    expect(acylName(4, [2], [], [])).toBe("but-2-enoyl");
  });

  it("prop-2-ynoyl (3C, triple at position 2)", () => {
    expect(acylName(3, [], [2], [])).toBe("prop-2-ynoyl");
  });
});

describe("acylHalideName", () => {
  it("ethanoyl + Cl → ethanoyl chloride (PubChem: acetyl chloride, retained; systematic)", () => {
    expect(acylHalideName("ethanoyl", "Cl")).toBe("ethanoyl chloride");
  });

  it("propanoyl + Br → propanoyl bromide", () => {
    expect(acylHalideName("propanoyl", "Br")).toBe("propanoyl bromide");
  });

  it("ethanoyl + F → ethanoyl fluoride", () => {
    expect(acylHalideName("ethanoyl", "F")).toBe("ethanoyl fluoride");
  });

  it("ethanoyl + I → ethanoyl iodide", () => {
    expect(acylHalideName("ethanoyl", "I")).toBe("ethanoyl iodide");
  });

  it("prop-2-enoyl + Cl → prop-2-enoyl chloride", () => {
    expect(acylHalideName("prop-2-enoyl", "Cl")).toBe("prop-2-enoyl chloride");
  });
});

describe("esterName", () => {
  it("ethyl ethanoate (ethyl + 2C acyl, PubChem: ethyl acetate, retained; systematic)", () => {
    expect(esterName("ethyl", 2, [], [], [])).toBe("ethyl ethanoate");
  });

  it("methyl propanoate (methyl + 3C acyl, PubChem: methyl propanoate, systematic ✓)", () => {
    expect(esterName("methyl", 3, [], [], [])).toBe("methyl propanoate");
  });

  it("propan-2-yl ethanoate (propan-2-yl + 2C acyl, PubChem: propan-2-yl acetate, retained; systematic)", () => {
    expect(esterName("propan-2-yl", 2, [], [], [])).toBe("propan-2-yl ethanoate");
  });

  it("methyl prop-2-enoate (methyl + 3C acyl with C2=C3 double, PubChem: methyl prop-2-enoate ✓)", () => {
    expect(esterName("methyl", 3, [2], [], [])).toBe("methyl prop-2-enoate");
  });

  it("methyl methanoate (methyl + 1C acyl — methyl formate)", () => {
    expect(esterName("methyl", 1, [], [], [])).toBe("methyl methanoate");
  });

  it("ethyl but-2-enoate (ethyl + 4C acyl with double at 2)", () => {
    expect(esterName("ethyl", 4, [2], [], [])).toBe("ethyl but-2-enoate");
  });
});

describe("anhydrideName", () => {
  it("ethanoic anhydride (symmetric, PubChem: acetyl acetate; we assert systematic)", () => {
    expect(anhydrideName("ethanoic", "ethanoic")).toBe("ethanoic anhydride");
  });

  it("propanoic anhydride (symmetric)", () => {
    expect(anhydrideName("propanoic", "propanoic")).toBe("propanoic anhydride");
  });

  it("ethanoic propanoic anhydride (mixed, alphabetical, PubChem: acetyl propanoate; systematic)", () => {
    expect(anhydrideName("ethanoic", "propanoic")).toBe("ethanoic propanoic anhydride");
  });

  it("ethanoic propanoic anhydride (inputs reversed — still alphabetical)", () => {
    // Alphabetical order: ethanoic < propanoic → same result regardless of input order
    expect(anhydrideName("propanoic", "ethanoic")).toBe("ethanoic propanoic anhydride");
  });

  it("butanoic ethanoic anhydride (alphabetical: but < eth)", () => {
    expect(anhydrideName("butanoic", "ethanoic")).toBe("butanoic ethanoic anhydride");
  });
});
