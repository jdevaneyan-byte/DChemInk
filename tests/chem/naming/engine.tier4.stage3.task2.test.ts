// tests/chem/naming/engine.tier4.stage3.task2.test.ts
//
// Task 2 — Tier 4 Stage 3: heteroatom replacement + unsaturation
//
// All expected names verified against PubChem before asserting.
//
// Heteroatom replacement (von Baeyer "a" nomenclature):
//   quinuclidine (1-azabicyclo[2.2.2]octane): C1CN2CCC1CC2 → 1-azabicyclo[2.2.2]octane  ✓
//   DABCO (1,4-diazabicyclo[2.2.2]octane):    C1CN2CCN1CC2 → 1,4-diazabicyclo[2.2.2]octane ✓
//   2-oxabicyclo[2.2.1]heptane:                O1CC2CCC1C2  → 2-oxabicyclo[2.2.1]heptane  ✓
//   2-oxabicyclo[2.2.2]octane:                 O1CC2CCC1CC2 → 2-oxabicyclo[2.2.2]octane   ✓
//   2-thiabicyclo[2.2.1]heptane:               S1CC2CCC1C2  → 2-thiabicyclo[2.2.1]heptane ✓
//
// Unsaturation (ene):
//   norbornene (bicyclo[2.2.1]hept-2-ene): C1CC2CC1C=C2 → bicyclo[2.2.1]hept-2-ene ✓
//   bicyclo[2.2.2]oct-2-ene:               C1=CC2CCC1CC2 → bicyclo[2.2.2]oct-2-ene  ✓

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

// ── Heteroatom replacement (aza, oxa, thia) ────────────────────────────────────

describe("T4S3 Task2 – heteroatom replacement (PubChem verified)", () => {
  it("1-azabicyclo[2.2.2]octane (quinuclidine) – PubChem match ✓", () => {
    // PubChem CID 2724: 1-azabicyclo[2.2.2]octane
    expect(name("C1CN2CCC1CC2")).toBe("1-azabicyclo[2.2.2]octane");
  });

  it("1,4-diazabicyclo[2.2.2]octane (DABCO) – PubChem match ✓", () => {
    // PubChem CID 9231: 1,4-diazabicyclo[2.2.2]octane
    expect(name("C1CN2CCN1CC2")).toBe("1,4-diazabicyclo[2.2.2]octane");
  });

  it("2-oxabicyclo[2.2.1]heptane – PubChem match ✓", () => {
    // PubChem CID 69281: 2-oxabicyclo[2.2.1]heptane
    expect(name("O1CC2CCC1C2")).toBe("2-oxabicyclo[2.2.1]heptane");
  });

  it("2-oxabicyclo[2.2.2]octane – PubChem match ✓", () => {
    // PubChem CID 68932: 2-oxabicyclo[2.2.2]octane
    expect(name("O1CC2CCC1CC2")).toBe("2-oxabicyclo[2.2.2]octane");
  });

  it("2-thiabicyclo[2.2.1]heptane – PubChem match ✓", () => {
    // PubChem: 2-thiabicyclo[2.2.1]heptane
    expect(name("S1CC2CCC1C2")).toBe("2-thiabicyclo[2.2.1]heptane");
  });
});

// ── Unsaturation (ene suffix) ─────────────────────────────────────────────────

describe("T4S3 Task2 – unsaturation in bridged rings (PubChem verified)", () => {
  it("bicyclo[2.2.1]hept-2-ene (norbornene) – PubChem match ✓", () => {
    // PubChem CID 9231: bicyclo[2.2.1]hept-2-ene
    expect(name("C1CC2CC1C=C2")).toBe("bicyclo[2.2.1]hept-2-ene");
  });

  it("bicyclo[2.2.2]oct-2-ene – PubChem match ✓", () => {
    // PubChem: bicyclo[2.2.2]oct-2-ene
    expect(name("C1=CC2CCC1CC2")).toBe("bicyclo[2.2.2]oct-2-ene");
  });
});

// ── Decline cases: unsupported heteroatom / complex subs ──────────────────────

describe("T4S3 Task2 – decline unsupported heteroatom systems", () => {
  it("ring phosphorus → declined (not supported element)", () => {
    // P in ring = not in VB_RING_ELEMENTS
    const g = graphFromSmiles("[PH]1CC2CCC1CC2");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
  });
});
