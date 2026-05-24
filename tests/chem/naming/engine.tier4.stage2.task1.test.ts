// tests/chem/naming/engine.tier4.stage2.task1.test.ts
//
// Task 1 — Stage 0: multi-ring perception + classification
//
// Perception:
//   naphthalene   c1ccc2ccccc2c1   → fused, 2 rings
//   quinoline     c1ccc2ncccc2c1   → fused, 2 rings
//   spiro         C1CCC2(CC1)CCCCC2 → spiro, declined
//   norbornane    C1CC2CCC1C2       → bridged, declined
//   biphenyl      c1ccccc1-c1ccccc1 → assembly, declined
//
// Engine routing (stub):
//   naphthalene → status "unsupported", reason contains "fused ring system not yet supported"
//   spiro → status "unsupported", reason contains "spiro"
//   bridged → status "unsupported", reason contains "bridged"
//   assembly → status "unsupported", reason contains "assembly"

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";
import { perceiveRingSystem } from "@/chem/naming/ring";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function graph(smiles: string) {
  return graphFromSmiles(smiles)!;
}

function status(smiles: string) {
  const g = graph(smiles);
  return nameMolecule(g).status;
}
function reason(smiles: string) {
  const g = graph(smiles);
  return nameMolecule(g).reason ?? "";
}

// ── perceiveRingSystem ────────────────────────────────────────────────────────
describe("perceiveRingSystem – classification", () => {
  it("naphthalene is fused with 2 rings", () => {
    const g = graph("c1ccc2ccccc2c1");
    const sys = perceiveRingSystem(g);
    expect(sys.ringCount).toBe(2);
    expect(sys.kind).toBe("fused");
  });

  it("quinoline is fused with 2 rings", () => {
    const g = graph("c1ccc2ncccc2c1");
    const sys = perceiveRingSystem(g);
    expect(sys.ringCount).toBe(2);
    expect(sys.kind).toBe("fused");
  });

  it("benzene is mono with 1 ring", () => {
    const g = graph("c1ccccc1");
    const sys = perceiveRingSystem(g);
    expect(sys.ringCount).toBe(1);
    expect(sys.kind).toBe("mono");
  });

  it("spiro compound is spiro", () => {
    const g = graph("C1CCC2(CC1)CCCCC2");
    const sys = perceiveRingSystem(g);
    expect(sys.kind).toBe("spiro");
  });

  it("norbornane is bridged", () => {
    const g = graph("C1CC2CCC1C2");
    const sys = perceiveRingSystem(g);
    expect(sys.kind).toBe("bridged");
  });

  it("biphenyl is assembly", () => {
    const g = graph("c1ccccc1-c1ccccc1");
    const sys = perceiveRingSystem(g);
    expect(sys.kind).toBe("assembly");
  });
});

// ── Engine routing ────────────────────────────────────────────────────────────
describe("engine routing – Stage 0 stubs", () => {
  it("naphthalene → now named (Task 2 fused table implemented)", () => {
    // Task 2 added the curated fused ring table; naphthalene is now supported.
    expect(status("c1ccc2ccccc2c1")).toBe("named");
  });

  it("spiro → unsupported, reason mentions spiro", () => {
    expect(status("C1CCC2(CC1)CCCCC2")).toBe("unsupported");
    expect(reason("C1CCC2(CC1)CCCCC2")).toMatch(/spiro/i);
  });

  it("norbornane → now named (Stage 3 bridged implemented)", () => {
    // Stage 3 (T4S3) implemented von Baeyer bridged naming; norbornane is now supported.
    expect(status("C1CC2CCC1C2")).toBe("named");
    expect(nameMolecule(graph("C1CC2CCC1C2")).name).toBe("bicyclo[2.2.1]heptane");
  });

  it("biphenyl → unsupported, reason mentions assembly", () => {
    expect(status("c1ccccc1-c1ccccc1")).toBe("unsupported");
    expect(reason("c1ccccc1-c1ccccc1")).toMatch(/assembly/i);
  });
});

// ── Existing mono-ring cases still pass ──────────────────────────────────────
describe("regression – mono-ring still works", () => {
  it("benzene still named benzene", () => {
    const g = graph("c1ccccc1");
    expect(nameMolecule(g).name).toBe("benzene");
  });
  it("pyridine still named pyridine", () => {
    const g = graph("c1ccncc1");
    expect(nameMolecule(g).name).toBe("pyridine");
  });
});
