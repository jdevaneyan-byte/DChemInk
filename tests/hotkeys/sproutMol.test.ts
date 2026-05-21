import { describe, it, expect } from "vitest";
import {
  FRAGMENT_DEFS,
  changeAtomChargeInV3000,
  chooseNewBondAngle,
} from "@/hotkeys/sproutMol";

describe("FRAGMENT_DEFS coverage", () => {
  it("has all the SPROUT value codes wired", () => {
    // Every numeric SPROUT value that we implement.
    for (const code of [
      "0", "1", "2", "3", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
    ]) {
      expect(FRAGMENT_DEFS[code], `missing fragment ${code}`).toBeDefined();
    }
  });

  it("methylidene (8) attaches with a double bond", () => {
    expect(FRAGMENT_DEFS["8"].connectingBondType).toBe(2);
  });

  it("gem-dimethyl (9) attaches two atoms to the active atom", () => {
    expect(FRAGMENT_DEFS["9"].connectingAtoms).toEqual([1, 2]);
  });

  it("alkyne (10) has an internal triple bond", () => {
    expect(FRAGMENT_DEFS["10"].bonds[0].type).toBe(3);
  });

  it("sulfonyl (14) is S with two double-bonded O", () => {
    const f = FRAGMENT_DEFS["14"];
    expect(f.atoms[0].element).toBe("S");
    expect(f.atoms.filter((a) => a.element === "O")).toHaveLength(2);
    expect(f.bonds.every((b) => b.type === 2)).toBe(true);
  });

  it("oxidize adds one double-bonded O", () => {
    expect(FRAGMENT_DEFS.oxidize.atoms).toEqual([
      { element: "O", dx: 1.0, dy: 0.0 },
    ]);
    expect(FRAGMENT_DEFS.oxidize.connectingBondType).toBe(2);
  });
});

describe("chooseNewBondAngle", () => {
  it("returns 0 (right) when the atom has no neighbours", () => {
    expect(chooseNewBondAngle(0, 0, [])).toBe(0);
  });

  it("places ~120° from a single neighbour, picking the upward side", () => {
    // Neighbour directly to the left (angle π). New bond should be at +60°
    // (upward-right), i.e. π/3 radians.
    const a = chooseNewBondAngle(0, 0, [{ x: -1, y: 0 }]);
    expect(a).toBeCloseTo(Math.PI / 3, 4);
  });

  it("bisects the largest gap for 2+ neighbours", () => {
    // Neighbours at 0° and 90°. Largest gap spans 90°→360° (270°); its
    // bisector is at 225°.
    const a = chooseNewBondAngle(0, 0, [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect((a * 180) / Math.PI).toBeCloseTo(225, 0);
  });
});

const V3000_METHANE = `
  DChemInk

  0  0  0  0  0  0  0  0  0  0  0 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 1 0 0 0 0
M  V30 BEGIN ATOM
M  V30 1 N 0.0000 0.0000 0.0 0
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 END BOND
M  V30 END CTAB
M  END`;

describe("changeAtomChargeInV3000", () => {
  it("adds CHG=1 when incrementing a neutral atom", () => {
    const out = changeAtomChargeInV3000(V3000_METHANE, 0, 1);
    expect(out).toMatch(/M {2}V30 1 N .* CHG=1/);
  });

  it("adds CHG=-1 when decrementing a neutral atom", () => {
    const out = changeAtomChargeInV3000(V3000_METHANE, 0, -1);
    expect(out).toMatch(/CHG=-1/);
  });

  it("removes CHG when the charge returns to zero", () => {
    const plus = changeAtomChargeInV3000(V3000_METHANE, 0, 1)!;
    const back = changeAtomChargeInV3000(plus, 0, -1)!;
    expect(back).not.toMatch(/CHG=/);
  });

  it("returns null for an out-of-range atom index", () => {
    expect(changeAtomChargeInV3000(V3000_METHANE, 5, 1)).toBeNull();
  });
});
