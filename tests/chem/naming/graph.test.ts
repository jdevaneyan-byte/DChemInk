import { describe, it, expect } from "vitest";
import { parentStem, multiplierPrefix, compareLocants } from "@/chem/naming/graph";

describe("parentStem", () => {
  it("maps carbon counts to hydride stems", () => {
    expect(parentStem(1)).toBe("meth");
    expect(parentStem(4)).toBe("but");
    expect(parentStem(8)).toBe("oct");
    expect(parentStem(12)).toBe("dodec");
  });
  it("throws above the supported range", () => {
    expect(() => parentStem(21)).toThrow();
  });
});

describe("multiplierPrefix", () => {
  it("is empty for 1 and di/tri/tetra above", () => {
    expect(multiplierPrefix(1)).toBe("");
    expect(multiplierPrefix(2)).toBe("di");
    expect(multiplierPrefix(3)).toBe("tri");
    expect(multiplierPrefix(4)).toBe("tetra");
  });
});

describe("compareLocants", () => {
  it("orders by first point of difference, then length", () => {
    expect(compareLocants([2, 4], [2, 5])).toBe(-1);
    expect(compareLocants([3], [2, 2])).toBe(1);
    expect(compareLocants([1, 1], [1, 1])).toBe(0);
  });
});
