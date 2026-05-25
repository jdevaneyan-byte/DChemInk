// tests/chem/naming/engine.tier5.stereo.test.ts — T5 stereodescriptors.
// All expected names PubChem-verified (see p1.3-tier5-stereo-design.md).

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";
import { inchiKeyOf } from "@/chem/naming/verify";

const require = createRequire(import.meta.url);
let opsinAvailable = false;
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
  const t = spawnSync("java", ["-jar", "/tmp/opsin.jar", "-osmi"], { input: "ethanol\n", encoding: "utf8", timeout: 5000 });
  opsinAvailable = t.status === 0 && t.stdout.trim().length > 0;
});

function name(smiles: string): string | null {
  const g = graphFromSmiles(smiles);
  if (!g) return null;
  return nameMolecule(g).name;
}
function result(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) throw new Error(`bad smiles ${smiles}`);
  return nameMolecule(g);
}
function opsinSmiles(n: string): string | null {
  const r = spawnSync("java", ["-jar", "/tmp/opsin.jar", "-osmi"], { input: n + "\n", encoding: "utf8", timeout: 10000 });
  const o = r.stdout.trim();
  return o.length > 0 ? o : null;
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
  it("(2S,3S)-2,3-dihydroxybutanedioic acid (L-tartaric)", () => {
    expect(name("OC(=O)[C@@H](O)[C@H](O)C(=O)O")).toBe("(2S,3S)-2,3-dihydroxybutanedioic acid");
  });
});

describe("T5 – ring stereocenters (1,2-disubstituted)", () => {
  it("(1S,2R)-2-methylcyclohexan-1-ol (cis- omitted; R/S is the PIN)", () => {
    expect(name("C[C@@H]1CCCC[C@@H]1O")).toBe("(1S,2R)-2-methylcyclohexan-1-ol");
  });
  it("(1R,2S)-2-methylcyclohexan-1-ol", () => {
    expect(name("C[C@H]1CCCC[C@H]1O")).toBe("(1R,2S)-2-methylcyclohexan-1-ol");
  });
});

describe("T5 – combined atom + bond descriptor, sorted by locant", () => {
  it("(2R,3E)-pent-3-en-2-ol", () => {
    expect(name("C/C=C/[C@@H](C)O")).toBe("(2R,3E)-pent-3-en-2-ol");
  });
});

describe("T5 – decline pseudoasymmetric / cis-trans (no R/S label)", () => {
  // 1,4-disubstituted cyclohexanes have SPECIFIED stereo but no uppercase CIP
  // label (cis/trans, lowercase r/s) — we don't emit cis/trans, so decline
  // rather than drop the stereo and mis-denote the structure.
  it("cis/trans-4-methylcyclohexan-1-ol declines", () => {
    const r = result("C[C@H]1CC[C@H](O)CC1");
    expect(r.name).toBeNull();
    expect(r.status).toBe("unsupported");
  });
  it("4-aminocyclohexane analog declines", () => {
    expect(result("N[C@H]1CC[C@@H](C)CC1").name).toBeNull();
  });
});

describe("T5 – OPSIN round-trip (descriptor is structurally correct)", () => {
  it("L-alanine name → OPSIN → same stereo canonical SMILES", () => {
    const smi = "C[C@H](N)C(=O)O";
    const n = name(smi);
    expect(n).toBe("(2S)-2-aminopropanoic acid");
    if (!opsinAvailable) return;
    const o = opsinSmiles(n!);
    expect(o).not.toBeNull();
    expect(inchiKeyOf(o!)).toBe(inchiKeyOf(smi));
  });
  it("(1S,2R)-2-methylcyclohexan-1-ol round-trips with stereo", () => {
    const smi = "C[C@@H]1CCCC[C@@H]1O";
    const n = name(smi);
    if (!opsinAvailable) return;
    const o = opsinSmiles(n!);
    expect(o).not.toBeNull();
    expect(inchiKeyOf(o!)).toBe(inchiKeyOf(smi));
  });
});
