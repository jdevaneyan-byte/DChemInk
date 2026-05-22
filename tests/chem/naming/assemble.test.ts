import { describe, it, expect } from "vitest";
import { assembleName } from "@/chem/naming/assemble";

const sub = (locant: number, name: string) => ({ locant, name });

describe("assembleName", () => {
  it("names unbranched alkanes", () => {
    expect(assembleName({ chainLen: 4, doubles: [], triples: [], subs: [] })).toBe("butane");
  });
  it("names a single ene with its locant", () => {
    expect(assembleName({ chainLen: 5, doubles: [2], triples: [], subs: [] })).toBe("pent-2-ene");
  });
  it("inserts the -a- linker for dienes", () => {
    expect(assembleName({ chainLen: 4, doubles: [1, 3], triples: [], subs: [] })).toBe("buta-1,3-diene");
  });
  it("combines ene and yne", () => {
    expect(assembleName({ chainLen: 5, doubles: [1], triples: [4], subs: [] })).toBe("pent-1-en-4-yne");
  });
  it("alphabetizes substituents and applies multipliers", () => {
    // 4-ethyl-2,2-dimethylhexane: ethyl before methyl; di not counted in sort
    expect(assembleName({
      chainLen: 6, doubles: [], triples: [],
      subs: [sub(4, "ethyl"), sub(2, "methyl"), sub(2, "methyl")],
    })).toBe("4-ethyl-2,2-dimethylhexane");
  });

  it("parenthesizes complex substituents", () => {
    // 4-(2-methylpropyl)heptane
    expect(assembleName({
      chainLen: 7, doubles: [], triples: [],
      subs: [sub(4, "2-methylpropyl")],
    })).toBe("4-(2-methylpropyl)heptane");
  });

  it("alphabetizes a complex substituent by its first letter, not its leading locant", () => {
    // ethyl ('e') must come before (2-methylpropyl) ('m'), despite the latter's
    // leading '2'. Expect ethyl cited first.
    const name = assembleName({
      chainLen: 7, doubles: [], triples: [],
      subs: [sub(5, "2-methylpropyl"), sub(3, "ethyl")],
    });
    expect(name).toBe("3-ethyl-5-(2-methylpropyl)heptane");
  });
});
