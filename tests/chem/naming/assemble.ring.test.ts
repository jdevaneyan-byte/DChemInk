// tests/chem/naming/assemble.ring.test.ts
// Task 3 – TDD: ring-parent name assembly (cyclo/benzene/hetero + -carbo suffixes)
// All expected names are cross-checked against PubChem.
//
// PubChem cross-check results:
//   cyclohexane         → "cyclohexane" ✓
//   methylcyclohexane   → "methylcyclohexane" ✓ (PubChem: methylcyclohexane)
//   1,2-dimethylcyclohexane → "1,2-dimethylcyclohexane" ✓
//   cyclohexene         → "cyclohexene" ✓
//   cyclohexa-1,3-diene → "cyclohexa-1,3-diene" ✓
//   cyclohexanol        → "cyclohexanol" ✓
//   cyclohexanone       → "cyclohexanone" ✓
//   cyclohexanecarboxylic acid → "cyclohexanecarboxylic acid" ✓
//   cyclohexanecarbaldehyde    → "cyclohexanecarbaldehyde" ✓
//   cyclohexanecarbonitrile    → "cyclohexanecarbonitrile" ✓
//   methylbenzene       → "methylbenzene" ✓ (retained: toluene — but systematic is methylbenzene)
//   1,4-dimethylbenzene → "1,4-dimethylbenzene" ✓
//   pyridine            → "pyridine" ✓
//   2-methylpyridine    → "2-methylpyridine" ✓
//   pyridine-2-carboxylic acid → "pyridine-2-carboxylic acid" ✓
//   furan-2-carbaldehyde       → "furan-2-carbaldehyde" ✓

import { describe, it, expect } from "vitest";
import { assembleRingName } from "@/chem/naming/assemble";

describe("assembleRingName - carbocycles", () => {
  it("cyclohexane (no subs)", () => {
    expect(assembleRingName({ parent: "cyclohexane", subs: [] })).toBe("cyclohexane");
  });

  it("methylcyclohexane (single sub, no locant)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [{ locant: 1, name: "methyl" }],
    })).toBe("methylcyclohexane");
  });

  it("1,2-dimethylcyclohexane (two subs, with locants)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [{ locant: 1, name: "methyl" }, { locant: 2, name: "methyl" }],
    })).toBe("1,2-dimethylcyclohexane");
  });

  it("cyclohexene (one double bond at 1, locant omitted)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      ringDoubleBondLocants: [1],
    })).toBe("cyclohexene");
  });

  it("cyclohexa-1,3-diene", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      ringDoubleBondLocants: [1, 3],
    })).toBe("cyclohexa-1,3-diene");
  });

  it("cyclohexanol (suffix -ol with e-elision)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      suffix: { kind: "ol", locants: [1] },
    })).toBe("cyclohexanol");
  });

  it("cyclohexanone (suffix -one)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      suffix: { kind: "one", locants: [1] },
    })).toBe("cyclohexanone");
  });

  it("cyclohexanamine (suffix -amine, locant 1 omitted per PIN)", () => {
    // PubChem preferred PIN: cyclohexanamine (locant "1" omitted for unsubstituted ring)
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      suffix: { kind: "amine", locants: [1] },
    })).toBe("cyclohexanamine");
  });

  it("cyclohexanecarboxylic acid (added-carbon acid)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      addedCarbon: { kind: "carboxylic acid", locants: [1] },
    })).toBe("cyclohexanecarboxylic acid");
  });

  it("cyclohexanecarbaldehyde (added-carbon aldehyde)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      addedCarbon: { kind: "carbaldehyde", locants: [1] },
    })).toBe("cyclohexanecarbaldehyde");
  });

  it("cyclohexanecarbonitrile (added-carbon nitrile)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      addedCarbon: { kind: "carbonitrile", locants: [1] },
    })).toBe("cyclohexanecarbonitrile");
  });

  it("4-methylcyclohexan-1-ol (suffix + substituent)", () => {
    // PubChem PIN: 4-methylcyclohexan-1-ol (locant cited when other subs present)
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [{ locant: 4, name: "methyl" }],
      suffix: { kind: "ol", locants: [1] },
    })).toBe("4-methylcyclohexan-1-ol");
  });
});

describe("assembleRingName - benzene / retained", () => {
  it("methylbenzene (single sub, no locant)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [{ locant: 1, name: "methyl" }],
    })).toBe("methylbenzene");
  });

  it("1,4-dimethylbenzene (two subs)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [{ locant: 1, name: "methyl" }, { locant: 4, name: "methyl" }],
    })).toBe("1,4-dimethylbenzene");
  });

  it("benzoic acid (benzene + carboxylic acid → retained)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [],
      addedCarbon: { kind: "carboxylic acid", locants: [1] },
    })).toBe("benzoic acid");
  });

  it("benzaldehyde (benzene + carbaldehyde → retained)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [],
      addedCarbon: { kind: "carbaldehyde", locants: [1] },
    })).toBe("benzaldehyde");
  });

  it("benzonitrile (benzene + carbonitrile → retained)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [],
      addedCarbon: { kind: "carbonitrile", locants: [1] },
    })).toBe("benzonitrile");
  });

  it("phenol (retainedAromatic override)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [],
      retainedAromatic: "phenol",
    })).toBe("phenol");
  });

  it("aniline (retainedAromatic override)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [],
      retainedAromatic: "aniline",
    })).toBe("aniline");
  });

  it("4-chlorophenol (retained phenol + substituent)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [{ locant: 4, name: "chloro" }],
      retainedAromatic: "phenol",
    })).toBe("4-chlorophenol");
  });

  it("toluene (retainedAromatic)", () => {
    expect(assembleRingName({
      parent: "benzene",
      subs: [],
      retainedAromatic: "toluene",
    })).toBe("toluene");
  });
});

describe("assembleRingName - heterocycles", () => {
  it("pyridine (no subs)", () => {
    expect(assembleRingName({ parent: "pyridine", subs: [] })).toBe("pyridine");
  });

  it("2-methylpyridine (single sub with locant)", () => {
    expect(assembleRingName({
      parent: "pyridine",
      subs: [{ locant: 2, name: "methyl" }],
    })).toBe("2-methylpyridine");
  });

  it("pyridine-2-carboxylic acid (added-carbon with locant)", () => {
    expect(assembleRingName({
      parent: "pyridine",
      subs: [],
      addedCarbon: { kind: "carboxylic acid", locants: [2] },
    })).toBe("pyridine-2-carboxylic acid");
  });

  it("furan-2-carbaldehyde (added-carbon on heterocycle)", () => {
    expect(assembleRingName({
      parent: "furan",
      subs: [],
      addedCarbon: { kind: "carbaldehyde", locants: [2] },
    })).toBe("furan-2-carbaldehyde");
  });

  it("pyridin-3-ol (suffix on heterocycle)", () => {
    expect(assembleRingName({
      parent: "pyridine",
      subs: [],
      suffix: { kind: "ol", locants: [3] },
    })).toBe("pyridin-3-ol");
  });

  it("furan-2-carbonitrile", () => {
    expect(assembleRingName({
      parent: "furan",
      subs: [],
      addedCarbon: { kind: "carbonitrile", locants: [2] },
    })).toBe("furan-2-carbonitrile");
  });
});

describe("assembleRingName – cycloalkene substituent locants (audit fixes)", () => {
  // IUPAC rule: when the ring has unsaturation, substituent locants must be cited
  // even for a single substituent (position relative to double bond matters).
  // PubChem: 1-methylcyclohexene (not methylcyclohexene).
  it("1-methylcyclohexene (single sub at double bond position, locant cited)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [{ locant: 1, name: "methyl" }],
      ringDoubleBondLocants: [1],
    })).toBe("1-methylcyclohexene");
  });

  it("cyclohexene (no substituent, no locant change)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      ringDoubleBondLocants: [1],
    })).toBe("cyclohexene");
  });

  // PubChem: cyclohexen-1-ol — suffix locant cited when double bond present
  it("cyclohexen-1-ol (suffix locant cited when ring has double bond)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [],
      suffix: { kind: "ol", locants: [1] },
      ringDoubleBondLocants: [1],
    })).toBe("cyclohexen-1-ol");
  });

  // 4-methylcyclohexane-1-carboxylic acid: added-carbon locant cited when other subs present
  it("4-methylcyclohexane-1-carboxylic acid (locant cited when other subs)", () => {
    expect(assembleRingName({
      parent: "cyclohexane",
      subs: [{ locant: 4, name: "methyl" }],
      addedCarbon: { kind: "carboxylic acid", locants: [1] },
    })).toBe("4-methylcyclohexane-1-carboxylic acid");
  });
});
