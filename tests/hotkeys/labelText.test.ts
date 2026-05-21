import { describe, it, expect } from "vitest";
import { applyLabelToMolfile, buildLabeledCxsmiles } from "@/hotkeys/labelText";

/** A minimal MOL V2000 with two carbons. */
const ETHANE_MOL = `
  Mrv1234

  2  1  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
M  END
`;

describe("applyLabelToMolfile (MOL A-record path, kept for graphs that need it)", () => {
  it("inserts an A record for atom 0 with label 'Me' before M  END", () => {
    const out = applyLabelToMolfile(ETHANE_MOL, 0, "Me");
    expect(out).toMatch(/A\s+1\s*\nMe/);
  });

  it("throws if atomIdx is out of range", () => {
    expect(() => applyLabelToMolfile(ETHANE_MOL, 99, "Me")).toThrow(/atom index/);
  });

  it("accepts labels longer than 3 chars", () => {
    expect(applyLabelToMolfile(ETHANE_MOL, 0, "TBDMS")).toMatch(/A\s+1\s*\nTBDMS/);
  });
});

describe("buildLabeledCxsmiles (the path applyLabel actually uses)", () => {
  it("attaches a label to a single atom", () => {
    expect(buildLabeledCxsmiles("CC", 0, "Me", 2)).toBe("CC |$Me;$|");
  });

  it("attaches a label to a later atom", () => {
    expect(buildLabeledCxsmiles("CCO", 2, "Ph", 3)).toBe("CCO |$;;Ph$|");
  });

  it("trims surrounding whitespace from SMILES", () => {
    expect(buildLabeledCxsmiles("  CC  ", 0, "Me", 2)).toBe("CC |$Me;$|");
  });

  it("throws if atomIdx is out of range", () => {
    expect(() => buildLabeledCxsmiles("CC", 5, "Me", 2)).toThrow(/atom index/);
  });
});
