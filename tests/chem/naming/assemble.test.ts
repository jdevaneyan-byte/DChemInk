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

  // Regression: a single substituent on ethane omits its degenerate locant, but
  // TWO substituents must keep locants (1,1 vs 1,2 differ). PubChem-verified.
  it("chloroethane omits the locant; 1,1-dichloroethane keeps them", () => {
    expect(assembleName({ chainLen: 2, doubles: [], triples: [],
      subs: [sub(1, "chloro")] })).toBe("chloroethane");
    expect(assembleName({ chainLen: 2, doubles: [], triples: [],
      subs: [sub(1, "chloro"), sub(1, "chloro")] })).toBe("1,1-dichloroethane");
  });

  // Regression: di-nitrile/-amide are terminal-forced like dial/dioic acid, so
  // their locants are omitted. PubChem: N#CCC#N -> propanedinitrile.
  it("propanedinitrile omits locants (terminal dinitrile)", () => {
    expect(assembleName({ chainLen: 3, doubles: [], triples: [], subs: [],
      suffix: { kind: "nitrile", locants: [1, 3] } })).toBe("propanedinitrile");
  });

  // Regression: the trailing 'a' of "tetra" elides before the vowel of "-ol".
  // PubChem: OCC(O)C(O)CO -> butane-1,2,3,4-tetrol.
  it("butane-1,2,3,4-tetrol elides the multiplier 'a' before 'ol'", () => {
    expect(assembleName({ chainLen: 4, doubles: [], triples: [], subs: [],
      suffix: { kind: "ol", locants: [1, 2, 3, 4] } })).toBe("butane-1,2,3,4-tetrol");
  });
});

// ── Euphony: -a- linker rules ─────────────────────────────────────────────────
describe("assembleName euphony: -a- linker", () => {
  // The 'a' linker is inserted ONLY when the first unsaturation descriptor is
  // multiplied (diene, triene …) or when the molecule contains ONLY multiple
  // triple bonds (diyne, triyne …).
  // A single ene followed by multiplied ynes does NOT take the 'a'.
  // PubChem reference: C=CC#CC#CC → hept-1-en-3,5-diyne (no 'a' before single ene).

  it("buta-1,3-diene keeps the -a- (diene = multiplied ene)", () => {
    // doubles=[1,3] → needA (diene is multiplied first descriptor)
    expect(assembleName({ chainLen: 4, doubles: [1, 3], triples: [], subs: [] }))
      .toBe("buta-1,3-diene");
  });

  it("hepta-1,3,5-triene keeps the -a-", () => {
    expect(assembleName({ chainLen: 7, doubles: [1, 3, 5], triples: [], subs: [] }))
      .toBe("hepta-1,3,5-triene");
  });

  it("hepta-1,3-dien-5-yne keeps the -a- (diene comes first, is multiplied)", () => {
    expect(assembleName({ chainLen: 7, doubles: [1, 3], triples: [5], subs: [] }))
      .toBe("hepta-1,3-dien-5-yne");
  });

  it("hept-1-en-3,5-diyne has NO -a- (single ene, even though diyne is multiplied)", () => {
    // Bug: current code incorrectly gives hepta-1-en-3,5-diyne.
    // PubChem-verified: hept-1-en-3,5-diyne (no 'a').
    expect(assembleName({ chainLen: 7, doubles: [1], triples: [3, 5], subs: [] }))
      .toBe("hept-1-en-3,5-diyne");
  });

  it("hepta-1,3-diyne keeps the -a- (only ynes, multiplied)", () => {
    expect(assembleName({ chainLen: 7, doubles: [], triples: [1, 3], subs: [] }))
      .toBe("hepta-1,3-diyne");
  });

  it("pent-1-en-4-yne has NO -a- (single ene + single yne)", () => {
    expect(assembleName({ chainLen: 5, doubles: [1], triples: [4], subs: [] }))
      .toBe("pent-1-en-4-yne");
  });

  it("octa-1,3,5,7-tetraene keeps the -a-", () => {
    expect(assembleName({ chainLen: 8, doubles: [1, 3, 5, 7], triples: [], subs: [] }))
      .toBe("octa-1,3,5,7-tetraene");
  });
});
