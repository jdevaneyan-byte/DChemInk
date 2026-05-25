// tests/chem/naming/adapter.stereo.test.ts — T5 Task 1: CIP extraction.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

describe("T5 Task1 – adapter extracts CIP stereo", () => {
  it("specified tetrahedral center → stereoAtoms label", () => {
    const g = graphFromSmiles("C[C@@H](N)C(=O)O")!;
    expect(g.stereoAtoms).toBeDefined();
    expect(g.stereoAtoms!.size).toBe(1);
    const label = [...g.stereoAtoms!.values()][0];
    expect(["R", "S"]).toContain(label);
  });

  it("specified C=C → stereoBonds E/Z", () => {
    const g = graphFromSmiles("C/C=C/C")!; // (E)-but-2-ene
    expect(g.stereoBonds).toBeDefined();
    expect(g.stereoBonds!.length).toBe(1);
    expect(g.stereoBonds![0].label).toBe("E");
  });

  it("cis double bond → Z", () => {
    const g = graphFromSmiles("C/C=C\\C")!;
    expect(g.stereoBonds![0].label).toBe("Z");
  });

  it("UNspecified stereo → no descriptors (never invent)", () => {
    const g = graphFromSmiles("CC(N)C(=O)O")!; // alanine, no @
    expect(g.stereoAtoms).toBeUndefined();
    const g2 = graphFromSmiles("CC=CC")!; // 2-butene, no /\
    expect(g2.stereoBonds).toBeUndefined();
  });

  it("two stereocenters → both labelled", () => {
    const g = graphFromSmiles("C[C@@H](O)[C@H](O)C")!; // butane-2,3-diol
    expect(g.stereoAtoms!.size).toBe(2);
  });
});
