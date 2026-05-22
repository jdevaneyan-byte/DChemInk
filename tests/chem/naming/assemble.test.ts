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
  it("omits the degenerate locant on a 2-carbon chain (ethene/ethyne)", () => {
    // On 2 carbons the unsaturation can only be at position 1, so the locant is
    // omitted (matches PubChem: C=C -> ethene, C#C -> ethyne). prop-1-ene KEEPS
    // its locant, so the omission is specific to the 2-carbon stem.
    expect(assembleName({ chainLen: 2, doubles: [1], triples: [], subs: [] })).toBe("ethene");
    expect(assembleName({ chainLen: 2, doubles: [], triples: [1], subs: [] })).toBe("ethyne");
    expect(assembleName({ chainLen: 3, doubles: [1], triples: [], subs: [] })).toBe("prop-1-ene");
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

// ── Tier-2: suffix assembly ────────────────────────────────────────────────────
describe("assembleName (Tier 2 suffix)", () => {
  // e-elision before vowel-initial suffix; locant cited for ol/one/amine
  it("butan-2-ol: drops e before 'o', cites locant", () => {
    expect(assembleName({ chainLen: 4, doubles: [], triples: [], subs: [],
      suffix: { kind: "ol", locants: [2] } })).toBe("butan-2-ol");
  });
  it("propanal: drops e before 'a', no locant for terminal al", () => {
    expect(assembleName({ chainLen: 3, doubles: [], triples: [], subs: [],
      suffix: { kind: "al", locants: [1] } })).toBe("propanal");
  });
  it("propan-2-one: drops e before 'o', cites locant for ketone", () => {
    expect(assembleName({ chainLen: 3, doubles: [], triples: [], subs: [],
      suffix: { kind: "one", locants: [2] } })).toBe("propan-2-one");
  });
  it("ethanamine: drops e before 'a', omits locant for 2-C amine", () => {
    // PubChem: ethanamine (not ethan-1-amine for 2-carbon)
    expect(assembleName({ chainLen: 2, doubles: [], triples: [], subs: [],
      suffix: { kind: "amine", locants: [1] } })).toBe("ethanamine");
  });
  it("ethanoic acid: drops e before 'o', no locant for terminal acid", () => {
    // PubChem: acetic acid (retained); our systematic: ethanoic acid
    expect(assembleName({ chainLen: 2, doubles: [], triples: [], subs: [],
      suffix: { kind: "oic acid", locants: [1] } })).toBe("ethanoic acid");
  });
  it("ethanenitrile: KEEPS e before consonant 'n'", () => {
    // PubChem: acetonitrile (retained); our systematic: ethanenitrile
    expect(assembleName({ chainLen: 2, doubles: [], triples: [], subs: [],
      suffix: { kind: "nitrile", locants: [1] } })).toBe("ethanenitrile");
  });
  it("ethanamide: drops e before 'a', no locant for terminal amide", () => {
    // PubChem: acetamide (retained); our systematic: ethanamide
    expect(assembleName({ chainLen: 2, doubles: [], triples: [], subs: [],
      suffix: { kind: "amide", locants: [1] } })).toBe("ethanamide");
  });

  // Multiplicity: keeps 'e' before 'di' (consonant)
  it("butane-1,4-diol: keeps e before 'd' (di), locants in suffix", () => {
    expect(assembleName({ chainLen: 4, doubles: [], triples: [], subs: [],
      suffix: { kind: "ol", locants: [1, 4] } })).toBe("butane-1,4-diol");
  });
  it("hexanedioic acid: keeps e, no locants for diacid", () => {
    expect(assembleName({ chainLen: 6, doubles: [], triples: [], subs: [],
      suffix: { kind: "oic acid", locants: [1, 6] } })).toBe("hexanedioic acid");
  });
  it("pentanedial: keeps e, no locants for dial", () => {
    expect(assembleName({ chainLen: 5, doubles: [], triples: [], subs: [],
      suffix: { kind: "al", locants: [1, 5] } })).toBe("pentanedial");
  });
  it("hexane-2,5-dione: keeps e before 'di', cites locants", () => {
    expect(assembleName({ chainLen: 6, doubles: [], triples: [], subs: [],
      suffix: { kind: "one", locants: [2, 5] } })).toBe("hexane-2,5-dione");
  });

  // Unsaturation + suffix
  it("but-3-en-2-one: ene locant before suffix", () => {
    expect(assembleName({ chainLen: 4, doubles: [3], triples: [], subs: [],
      suffix: { kind: "one", locants: [2] } })).toBe("but-3-en-2-one");
  });

  // Prefix + suffix interplay
  it("1-chloropropan-2-ol: prefix + suffix", () => {
    expect(assembleName({ chainLen: 3, doubles: [], triples: [],
      subs: [sub(1, "chloro")],
      suffix: { kind: "ol", locants: [2] } })).toBe("1-chloropropan-2-ol");
  });
});
