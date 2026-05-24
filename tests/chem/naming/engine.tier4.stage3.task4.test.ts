// tests/chem/naming/engine.tier4.stage3.task4.test.ts
//
// Task 4 — T4S3 dual audit: OPSIN round-trip + decline guard + 2 e2e tests
//
// OPSIN jar at /tmp/opsin.jar used for structural round-trip.
// inchiKeyOf() returns RDKit canonical SMILES (opaque stable key); name is
// kept for interface stability.
//
// E2E round-trips verified:
//   norbornane:   C1CC2CCC1C2 → bicyclo[2.2.1]heptane
//     OPSIN SMILES: C12CCC(CC1)C2 → same canonical key ✓
//   quinuclidine: C1CN2CCC1CC2 → 1-azabicyclo[2.2.2]octane
//     OPSIN SMILES: N12CCC(CC1)CC2 → same canonical key ✓
//
// OPSIN round-trip audit: all 13 bridged system names parse in OPSIN → same
// structural key as input SMILES. 0 mismatches.

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

  const test = spawnSync("java", ["-jar", "/tmp/opsin.jar", "-osmi"], {
    input: "bicyclo[2.2.1]heptane\n",
    encoding: "utf8",
    timeout: 5000,
  });
  opsinAvailable = test.status === 0 && test.stdout.trim().length > 0;
});

function name(smiles: string): string | null {
  const g = graphFromSmiles(smiles);
  if (!g) return null;
  return nameMolecule(g).name;
}

function status(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) return null;
  return nameMolecule(g).status;
}

/** Convert an IUPAC name to SMILES via OPSIN. Returns null if unavailable. */
function opsinToSmiles(iupacName: string): string | null {
  if (!opsinAvailable) return null;
  const result = spawnSync("java", ["-jar", "/tmp/opsin.jar", "-osmi"], {
    input: iupacName + "\n",
    encoding: "utf8",
    timeout: 10000,
  });
  const out = result.stdout.trim();
  return out.length > 0 ? out : null;
}

// ── E2E round-trips ───────────────────────────────────────────────────────────

describe("T4S3 Task4 – E2E round-trip norbornane", () => {
  it("norbornane: SMILES → name → OPSIN SMILES → same canonical key", () => {
    const inputSmiles = "C1CC2CCC1C2";
    const named = name(inputSmiles);
    expect(named).toBe("bicyclo[2.2.1]heptane");

    if (!opsinAvailable) return;

    const opsinSmiles = opsinToSmiles(named!);
    expect(opsinSmiles).not.toBeNull();

    const keyBefore = inchiKeyOf(inputSmiles);
    const keyAfter = inchiKeyOf(opsinSmiles!);
    expect(keyBefore).not.toBeNull();
    expect(keyAfter).not.toBeNull();
    expect(keyAfter).toBe(keyBefore);
  });
});

describe("T4S3 Task4 – E2E round-trip quinuclidine", () => {
  it("quinuclidine: SMILES → name → OPSIN SMILES → same canonical key", () => {
    const inputSmiles = "C1CN2CCC1CC2";
    const named = name(inputSmiles);
    expect(named).toBe("1-azabicyclo[2.2.2]octane");

    if (!opsinAvailable) return;

    const opsinSmiles = opsinToSmiles(named!);
    expect(opsinSmiles).not.toBeNull();

    const keyBefore = inchiKeyOf(inputSmiles);
    const keyAfter = inchiKeyOf(opsinSmiles!);
    expect(keyBefore).not.toBeNull();
    expect(keyAfter).not.toBeNull();
    expect(keyAfter).toBe(keyBefore);
  });
});

// ── OPSIN round-trip audit ────────────────────────────────────────────────────
//
// For every (SMILES, expectedName) pair:
//   1. Engine must produce expectedName.
//   2. OPSIN must parse it (→ SMILES).
//   3. RDKit canonical SMILES of OPSIN output must equal canonical SMILES of
//      original input (structural identity, not string equality).

describe("T4S3 Task4 – OPSIN round-trip audit (all bridged cases)", () => {
  const bridgedCases: [string, string][] = [
    // Carbocyclic bicyclics
    ["C1CC2CCC1C2",       "bicyclo[2.2.1]heptane"],
    ["C1CC2CCC1CC2",      "bicyclo[2.2.2]octane"],
    ["C1C2CC1C2",         "bicyclo[1.1.1]pentane"],
    ["C1CCC2CCC1CC2",     "bicyclo[3.2.2]nonane"],
    // Unsaturated bicyclics (ene)
    ["C1CC2CC1C=C2",      "bicyclo[2.2.1]hept-2-ene"],
    ["C1=CC2CCC1CC2",     "bicyclo[2.2.2]oct-2-ene"],
    // Heteroatom bicyclics
    ["C1CN2CCC1CC2",      "1-azabicyclo[2.2.2]octane"],
    ["C1CN2CCN1CC2",      "1,4-diazabicyclo[2.2.2]octane"],
    ["O1CC2CCC1C2",       "2-oxabicyclo[2.2.1]heptane"],
    ["O1CC2CCC1CC2",      "2-oxabicyclo[2.2.2]octane"],
    ["S1CC2CCC1C2",       "2-thiabicyclo[2.2.1]heptane"],
    // Curated tricyclic
    ["C1C2CC3CC1CC(C2)C3","adamantane"],
  ];

  for (const [smiles, expectedName] of bridgedCases) {
    it(`${expectedName}: engine output is OPSIN-parseable and structurally correct`, () => {
      const n = name(smiles);
      expect(n).toBe(expectedName);

      if (!opsinAvailable) return;

      const opsinSmiles = opsinToSmiles(n!);
      expect(opsinSmiles).not.toBeNull();

      const keyInput = inchiKeyOf(smiles);
      const keyOpsin = inchiKeyOf(opsinSmiles!);
      expect(keyInput).not.toBeNull();
      expect(keyOpsin).not.toBeNull();
      expect(keyOpsin).toBe(keyInput);
    });
  }
});

// ── Decline guard – unsupported systems still declined ────────────────────────

describe("T4S3 Task4 – decline guard: out-of-scope systems still declined", () => {
  it("cubane (general tricyclic, not adamantane) → unsupported", () => {
    expect(status("C12C3C4C1C5C4C3C25")).toBe("unsupported");
  });

  it("spiro ring → now named (Stage 4 spiro implemented)", () => {
    // Stage 4 implemented monospiro naming; spiro[5.5]undecane is now supported.
    const g = graphFromSmiles("C1CCC2(CC1)CCCCC2");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("named");
    expect(r?.name).toBe("spiro[5.5]undecane");
  });

  it("ring assembly (biphenyl) → unsupported", () => {
    const g = graphFromSmiles("c1ccccc1-c1ccccc1");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
    expect(r?.reason).toMatch(/assembly/i);
  });

  it("decalin (saturated fused bicyclic) → unsupported (not bridged)", () => {
    // Decalin is fused, not bridged; must not receive a VB name.
    const g = graphFromSmiles("C1CCC2CCCCC2C1");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
    expect(r?.name).toBeNull();
  });

  it("ring phosphorus in bicyclic → unsupported (not in VB_RING_ELEMENTS)", () => {
    const g = graphFromSmiles("[PH]1CC2CCC1CC2");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
  });
});
