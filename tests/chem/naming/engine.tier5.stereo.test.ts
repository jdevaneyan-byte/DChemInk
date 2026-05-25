// tests/chem/naming/engine.tier5.stereo.test.ts — T5 stereodescriptors.
// All expected names PubChem-verified (see p1.3-tier5-stereo-design.md).

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function name(smiles: string): string | null {
  const g = graphFromSmiles(smiles);
  if (!g) return null;
  return nameMolecule(g).name;
}

describe("T5 – E/Z double-bond descriptors (acyclic)", () => {
  it("(E)-but-2-ene (single bond: no stereo locant)", () => {
    expect(name("C/C=C/C")).toBe("(E)-but-2-ene");
  });
  it("(Z)-but-2-ene", () => {
    expect(name("C/C=C\\C")).toBe("(Z)-but-2-ene");
  });
  it("(Z)-pent-2-ene", () => {
    expect(name("CC/C=C\\C")).toBe("(Z)-pent-2-ene");
  });
  it("(E)-oct-2-ene", () => {
    expect(name("CCCCC/C=C/C")).toBe("(E)-oct-2-ene");
  });
  it("(2E,4E)-hexa-2,4-diene (multiple bonds: cite locants)", () => {
    expect(name("C/C=C/C=C/C")).toBe("(2E,4E)-hexa-2,4-diene");
  });
  it("(2E,4Z)-hexa-2,4-diene", () => {
    expect(name("C/C=C/C=C\\C")).toBe("(2E,4Z)-hexa-2,4-diene");
  });
});

describe("T5 – no descriptor when stereo unspecified", () => {
  it("but-2-ene without /\\ has no descriptor", () => {
    expect(name("CC=CC")).toBe("but-2-ene");
  });
  it("butan-2-ol without @ has no descriptor", () => {
    expect(name("CC(O)CC")).toBe("butan-2-ol");
  });
});

describe("T5 – R/S center descriptors (acyclic, single cites locant)", () => {
  it("(2R)-butan-2-ol", () => {
    expect(name("C[C@@H](O)CC")).toBe("(2R)-butan-2-ol");
  });
  it("(2R)-2-chlorobutane", () => {
    expect(name("C[C@@H](Cl)CC")).toBe("(2R)-2-chlorobutane");
  });
  it("(2R)-2-aminopropanoic acid (D-alanine)", () => {
    expect(name("C[C@@H](N)C(=O)O")).toBe("(2R)-2-aminopropanoic acid");
  });
  it("(2S)-2-aminopropanoic acid (L-alanine)", () => {
    expect(name("C[C@H](N)C(=O)O")).toBe("(2S)-2-aminopropanoic acid");
  });
});

describe("T5 – multiple R/S centers cite all locants", () => {
  it("(2R,3R)-butane-2,3-diol", () => {
    expect(name("C[C@@H](O)[C@H](O)C")).toBe("(2R,3R)-butane-2,3-diol");
  });
  it("(2R,3S)-butane-2,3-diol (meso)", () => {
    expect(name("C[C@@H](O)[C@@H](O)C")).toBe("(2R,3S)-butane-2,3-diol");
  });
});
