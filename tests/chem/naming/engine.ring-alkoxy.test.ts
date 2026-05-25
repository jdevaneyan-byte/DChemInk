// tests/chem/naming/engine.ring-alkoxy.test.ts
//
// Coverage class: alkoxy (methoxy/ethoxy/…) substituents on rings — anisole and
// friends, one of the most common substituents, previously declined wholesale.
// Simple linear alkoxy only; branched/unsaturated/hetero alkoxy declines
// (etherAlkoxyAtoms returns null). PubChem-verified; OPSIN round-trip confirmed.

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

describe("alkoxy substituents on rings (PubChem-verified)", () => {
  it("methoxybenzene (anisole)", () => expect(name("COc1ccccc1")).toBe("methoxybenzene"));
  it("ethoxybenzene", () => expect(name("CCOc1ccccc1")).toBe("ethoxybenzene"));
  it("propoxybenzene", () => expect(name("CCCOc1ccccc1")).toBe("propoxybenzene"));
  it("methoxycyclohexane", () => expect(name("COC1CCCCC1")).toBe("methoxycyclohexane"));
  it("4-methoxypyridine", () => expect(name("COc1ccncc1")).toBe("4-methoxypyridine"));
  it("1,2-dimethoxybenzene", () => expect(name("COc1ccccc1OC")).toBe("1,2-dimethoxybenzene"));
  it("1,2-dimethoxycyclohexane", () => expect(name("COC1CCCCC1OC")).toBe("1,2-dimethoxycyclohexane"));
});

describe("alkoxy + other substituent: locant + alphabetical tie-break", () => {
  it("1-methoxy-2-methylbenzene (methoxy < methyl → methoxy gets locant 1)", () => {
    expect(name("COc1ccccc1C")).toBe("1-methoxy-2-methylbenzene");
  });
  it("1-methoxy-4-methylbenzene", () => expect(name("COc1ccc(C)cc1")).toBe("1-methoxy-4-methylbenzene"));
  it("1-chloro-2-methoxybenzene (chloro < methoxy → chloro gets locant 1)", () => {
    expect(name("COc1ccccc1Cl")).toBe("1-chloro-2-methoxybenzene");
  });
});

describe("branched alkoxy on a ring declines (no wrong names)", () => {
  it("isopropoxybenzene declines (branched alkoxy not yet expressed)", () => {
    expect(status("CC(C)Oc1ccccc1")).toBe("unsupported");
  });
});
