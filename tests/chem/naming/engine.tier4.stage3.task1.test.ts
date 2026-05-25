// tests/chem/naming/engine.tier4.stage3.task1.test.ts
//
// Task 1 — Tier 4 Stage 3: bicyclic carbocyclic von Baeyer naming
//
// All expected names verified against PubChem before asserting:
//
//   norbornane:             C1CC2CCC1C2      → bicyclo[2.2.1]heptane    ✓ PubChem
//   bicyclo[2.2.2]octane:   C1CC2CCC1CC2     → bicyclo[2.2.2]octane     ✓ PubChem
//   bicyclo[1.1.1]pentane:  C1C2CC1C2        → bicyclo[1.1.1]pentane    ✓ PubChem
//   bicyclo[3.2.2]nonane:   C1CC2CCCC1CC2    → bicyclo[3.2.2]nonane     ✓ PubChem
//   bicyclo[2.2.1]hept-2-ene (norbornene): C1CC2CC1C=C2 → bicyclo[2.2.1]hept-2-ene ✓ PubChem
//
// decalin (C1CCC2CCCCC2C1): classifies as FUSED (2 atoms shared + bonded) → fused path;
//   PubChem name is "1,2,3,4,4a,5,6,7,8,8a-decahydronaphthalene" (not von Baeyer).
//   Our fused path declines it (not in curated table) → unsupported.
//   We verify it is NOT named as a bridged system.

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
  const g = graphFromSmiles(smiles);
  if (!g) throw new Error(`graphFromSmiles failed: ${smiles}`);
  return g;
}

function name(smiles: string): string | null {
  return nameMolecule(graph(smiles)).name;
}

// ── perceiveRingSystem sanity ──────────────────────────────────────────────────

describe("T4S3 Task1 – perceiveRingSystem: bridged classification", () => {
  it("norbornane classifies as bridged", () => {
    const g = graph("C1CC2CCC1C2");
    expect(perceiveRingSystem(g).kind).toBe("bridged");
  });

  it("bicyclo[2.2.2]octane classifies as bridged", () => {
    const g = graph("C1CC2CCC1CC2");
    expect(perceiveRingSystem(g).kind).toBe("bridged");
  });

  it("bicyclo[1.1.1]pentane classifies as bridged", () => {
    const g = graph("C1C2CC1C2");
    expect(perceiveRingSystem(g).kind).toBe("bridged");
  });

  it("decalin classifies as fused (not bridged)", () => {
    // C1CCC2CCCCC2C1: two 6-membered rings sharing a bond → fused
    const g = graph("C1CCC2CCCCC2C1");
    expect(perceiveRingSystem(g).kind).toBe("fused");
  });
});

// ── Core von Baeyer carbocyclic names ─────────────────────────────────────────

describe("T4S3 Task1 – carbocyclic von Baeyer names (PubChem verified)", () => {
  it("bicyclo[2.2.1]heptane (norbornane) – PubChem: bicyclo[2.2.1]heptane", () => {
    expect(name("C1CC2CCC1C2")).toBe("bicyclo[2.2.1]heptane");
  });

  it("bicyclo[2.2.1]heptane alternate SMILES", () => {
    // Same compound, different SMILES representation
    expect(name("C1CC2CC1CC2")).toBe("bicyclo[2.2.1]heptane");
  });

  it("bicyclo[2.2.2]octane – PubChem: bicyclo[2.2.2]octane", () => {
    expect(name("C1CC2CCC1CC2")).toBe("bicyclo[2.2.2]octane");
  });

  it("bicyclo[1.1.1]pentane – PubChem: bicyclo[1.1.1]pentane", () => {
    expect(name("C1C2CC1C2")).toBe("bicyclo[1.1.1]pentane");
  });

  it("bicyclo[3.2.2]nonane – PubChem: bicyclo[3.2.2]nonane", () => {
    expect(name("C1CC2CCCC1CC2")).toBe("bicyclo[3.2.2]nonane");
  });
});

// ── Unsaturation: norbornene ───────────────────────────────────────────────────

describe("T4S3 Task1 – bridged ring with unsaturation", () => {
  it("bicyclo[2.2.1]hept-2-ene (norbornene) – PubChem: bicyclo[2.2.1]hept-2-ene", () => {
    // C1CC2CC1C=C2 is norbornene; PubChem IUPAC: bicyclo[2.2.1]hept-2-ene
    expect(name("C1CC2CC1C=C2")).toBe("bicyclo[2.2.1]hept-2-ene");
  });
});

// ── Decline: decalin is fused, not bridged ────────────────────────────────────

describe("T4S3 Task1 – fused systems are NOT named as bridged", () => {
  it("decalin names as decahydronaphthalene, never as a von Baeyer bicyclo name", () => {
    // Must NOT be named as a von Baeyer bridged compound. Since T4 Stage 5 it is
    // correctly named via the hydrogenated-fused path (decahydronaphthalene).
    const r = nameMolecule(graph("C1CCC2CCCCC2C1"));
    expect(r.status).toBe("named");
    expect(r.name).toBe("1,2,3,4,4a,5,6,7,8,8a-decahydronaphthalene");
    expect(r.name).not.toMatch(/bicyclo/);
  });
});
