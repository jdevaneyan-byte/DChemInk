// tests/chem/naming/engine.alkenyl-substituents.test.ts
//
// Coverage class: alkenyl / alkynyl SUBSTITUENTS (ethenyl, prop-1-en-2-yl,
// prop-2-en-1-yl, ethynyl, …) on chains and rings. All OPSIN round-trip
// verified; preferred names cross-checked against PubChem (which uses the legacy
// no-parens / no-1-yl display, e.g. "prop-2-enylbenzene" — we emit the current
// IUPAC PIN form "(prop-2-en-1-yl)benzene", matching ChemDraw).

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});
const name = (s: string) => { const g = graphFromSmiles(s); return g ? nameMolecule(g).name : null; };
const status = (s: string) => { const g = graphFromSmiles(s); return g ? nameMolecule(g).status : null; };

describe("alkenyl/alkynyl substituents on a chain parent", () => {
  it("3,3-dimethylhex-1-ene (vinyl as chain unsaturation)", () => expect(name("CC(C)(C=C)CCC")).toBe("3,3-dimethylhex-1-ene"));
  it("2-ethenylbut-3-enoic acid (two vinyls on the acid carbon)", () => expect(name("C=CC(C=C)C(=O)O")).toBe("2-ethenylbut-3-enoic acid"));
  it("3-ethylhex-1-yne", () => expect(name("CCCC(CC)C#C")).toBe("3-ethylhex-1-yne"));
});

describe("alkenyl/alkynyl substituents on a ring parent", () => {
  it("(prop-2-en-1-yl)benzene (allylbenzene)", () => expect(name("C=CCc1ccccc1")).toBe("(prop-2-en-1-yl)benzene"));
  it("(prop-1-en-1-yl)benzene", () => expect(name("CC=Cc1ccccc1")).toBe("(prop-1-en-1-yl)benzene"));
  it("(prop-1-en-2-yl)benzene (isopropenyl: ene gets lowest locant)", () => expect(name("C(=C)(C)c1ccccc1")).toBe("(prop-1-en-2-yl)benzene"));
  it("(but-1-en-1-yl)benzene", () => expect(name("c1ccccc1C=C(CC)")).toBe("(but-1-en-1-yl)benzene"));
  it("ethenylcyclohexane (vinylcyclohexane)", () => expect(name("C=CC1CCCCC1")).toBe("ethenylcyclohexane"));
  it("ethynylbenzene (phenylacetylene)", () => expect(name("C#Cc1ccccc1")).toBe("ethynylbenzene"));
  it("1-ethenyl-2-methylbenzene", () => expect(name("c(C)1ccccc1C=C")).toBe("1-ethenyl-2-methylbenzene"));
});

describe("bare styrene retained name preserved", () => {
  it("styrene", () => expect(name("C=Cc1ccccc1")).toBe("styrene"));
});

describe("precision guards exposed by the alkenyl/diene work", () => {
  // Multiple double bonds but only one stereo-defined → the E/Z locant MUST be
  // cited to say which bond it is (was wrongly omitted as "(Z)-…diene").
  it("(5Z)-5-methylhepta-3,5-dienoic acid (E/Z locant cited with multiple enes)", () => {
    expect(name("C/C(C=CC(C(=O)O))=C/C")).toBe("(5Z)-5-methylhepta-3,5-dienoic acid");
  });
  it("(5E)-1-methoxyhepta-2,5-diene", () => {
    expect(name("C(C=CC(OC))/C=C/C")).toBe("(5E)-1-methoxyhepta-2,5-diene");
  });
  it("single double bond still omits the E/Z locant", () => {
    expect(name("C/C=C/C")).toBe("(E)-but-2-ene");
  });
  // A defined stereocentre next to an unassignable "(?)" centre → decline
  // (defined R/S labels are unreliable; OPSIN itself cannot assign CIP).
  it("2,6-dimethylcyclohexanol (pseudoasymmetric, undefined center) declines", () => {
    expect(status("C[C@@H]1CCCC(C)[C@@H]1O")).toBe("unsupported");
  });
});

describe("cumulated dienes (allenes) name; exocyclic methylidene declines", () => {
  it("(propa-1,2-dien-1-yl)cyclohexane (allenyl substituent)", () => {
    expect(name("C=C=CC1CCCCC1")).toBe("(propa-1,2-dien-1-yl)cyclohexane");
  });
  it("penta-2,3-diene (allene as chain parent)", () => {
    expect(name("CC=C=CC")).toBe("penta-2,3-diene");
  });
  it("exocyclic methylidene on ring declines (ring↔substituent C=C)", () => {
    expect(status("C=C1CCCCC1")).toBe("unsupported");
  });
});
