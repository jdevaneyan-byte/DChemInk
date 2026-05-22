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
});
