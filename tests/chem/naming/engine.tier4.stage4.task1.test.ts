// tests/chem/naming/engine.tier4.stage4.task1.test.ts
//
// Task 1 — Tier 4 Stage 4: carbocyclic monospiro ring naming
//
// All expected names PubChem-verified before asserting:
//
//   spiro[4.5]decane:   C1CCC2(CC1)CCCC2   → "spiro[4.5]decane"   PubChem CID 135982  ✓
//   spiro[5.5]undecane: C1CCC2(CC1)CCCCC2  → "spiro[5.5]undecane" PubChem CID 135983  ✓
//   spiro[3.3]heptane:  C1CC2(C1)CCC2       → "spiro[3.3]heptane"  PubChem CID 20277173 ✓
//   spiro[2.2]pentane:  C1CC12CC2           → "spiro[2.2]pentane"  PubChem CID 9088    ✓
//   spiro[4.4]nonane:   C1CCC2(C1)CCCC2    → "spiro[4.4]nonane"   PubChem CID 78959   ✓
//
// Dispiro (2 spiro atoms) → DECLINE (not mis-named).

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

// ── Ring system classification ────────────────────────────────────────────────

describe("T4S4 Task1 – perceiveRingSystem: spiro classification", () => {
  it("spiro[4.5]decane classifies as spiro", () => {
    expect(perceiveRingSystem(graph("C1CCC2(CC1)CCCC2")).kind).toBe("spiro");
  });

  it("spiro[3.3]heptane classifies as spiro", () => {
    expect(perceiveRingSystem(graph("C1CC2(C1)CCC2")).kind).toBe("spiro");
  });

  it("spiro[2.2]pentane classifies as spiro", () => {
    expect(perceiveRingSystem(graph("C1CC12CC2")).kind).toBe("spiro");
  });

  it("spiro[5.5]undecane classifies as spiro", () => {
    expect(perceiveRingSystem(graph("C1CCC2(CC1)CCCCC2")).kind).toBe("spiro");
  });

  it("bicyclo[2.2.1]heptane classifies as bridged (not spiro)", () => {
    expect(perceiveRingSystem(graph("C1CC2CCC1C2")).kind).toBe("bridged");
  });

  it("cyclohexane classifies as mono (not spiro)", () => {
    expect(perceiveRingSystem(graph("C1CCCCC1")).kind).toBe("mono");
  });
});

// ── Carbocyclic spiro names (PubChem verified) ────────────────────────────────

describe("T4S4 Task1 – carbocyclic spiro names (PubChem verified)", () => {
  it("spiro[4.5]decane – PubChem CID 135982", () => {
    // C1CCC2(CC1)CCCC2: 5-membered ring (a=4) + 6-membered ring (b=5), total 10 = decane
    expect(name("C1CCC2(CC1)CCCC2")).toBe("spiro[4.5]decane");
  });

  it("spiro[5.5]undecane – PubChem CID 135983", () => {
    // C1CCC2(CC1)CCCCC2: two 6-membered rings (a=b=5), total 11 = undecane
    expect(name("C1CCC2(CC1)CCCCC2")).toBe("spiro[5.5]undecane");
  });

  it("spiro[3.3]heptane – PubChem CID 20277173", () => {
    // C1CC2(C1)CCC2: two 4-membered rings (a=b=3), total 7 = heptane
    expect(name("C1CC2(C1)CCC2")).toBe("spiro[3.3]heptane");
  });

  it("spiro[2.2]pentane – PubChem CID 9088", () => {
    // C1CC12CC2: two 3-membered rings (a=b=2), total 5 = pentane
    expect(name("C1CC12CC2")).toBe("spiro[2.2]pentane");
  });

  it("spiro[4.4]nonane – PubChem CID 78959", () => {
    // C1CCC2(C1)CCCC2: two 5-membered rings (a=b=4), total 9 = nonane
    expect(name("C1CCC2(C1)CCCC2")).toBe("spiro[4.4]nonane");
  });
});

// ── Dispiro → DECLINE (no wrong names) ───────────────────────────────────────

describe("T4S4 Task1 – dispiro systems DECLINE correctly", () => {
  it("dispiro[2.0.2.1]heptane (2 spiro atoms) → decline", () => {
    // C1CC12CC23CC3: 3 rings sharing 2 spiro atoms → dispiro → DECLINE
    const result = nameMolecule(graph("C1CC12CC23CC3"));
    expect(result.name).toBeNull();
    expect(result.status).toBe("unsupported");
  });
});

// ── Non-regression: T1–T3 + T4 S1/S2/S3 still work ──────────────────────────

describe("T4S4 Task1 – non-regression checks", () => {
  it("cyclohexane still named (mono ring path)", () => {
    expect(name("C1CCCCC1")).toBe("cyclohexane");
  });

  it("naphthalene still named (fused path)", () => {
    expect(name("c1ccc2ccccc2c1")).toBe("naphthalene");
  });

  it("bicyclo[2.2.1]heptane still named (bridged path)", () => {
    expect(name("C1CC2CCC1C2")).toBe("bicyclo[2.2.1]heptane");
  });
});
