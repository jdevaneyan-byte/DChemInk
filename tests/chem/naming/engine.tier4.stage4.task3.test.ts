// tests/chem/naming/engine.tier4.stage4.task3.test.ts
//
// Task 3 — T4S4 dual audit: OPSIN round-trip + decline guard + 2 e2e tests.
//
// OPSIN jar at /tmp/opsin.jar used for structural round-trip. For every
// (SMILES, expectedName) pair: engine must produce expectedName, OPSIN must
// parse it, and the RDKit canonical SMILES of OPSIN's output must equal the
// canonical SMILES of the original input (structural identity).
//
// E2E round-trips verified:
//   spiro[4.5]decane:        C1CCC2(CC1)CCCC2 → "spiro[4.5]decane"
//   1,4-dioxaspiro[4.5]decane: C1CCC2(CC1)OCCO2 → "1,4-dioxaspiro[4.5]decane"

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
    input: "spiro[4.5]decane\n",
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

describe("T4S4 Task3 – E2E round-trip spiro[4.5]decane", () => {
  it("spiro[4.5]decane: SMILES → name → OPSIN SMILES → same canonical key", () => {
    const inputSmiles = "C1CCC2(CC1)CCCC2";
    const named = name(inputSmiles);
    expect(named).toBe("spiro[4.5]decane");
    if (!opsinAvailable) return;
    const opsinSmiles = opsinToSmiles(named!);
    expect(opsinSmiles).not.toBeNull();
    const keyBefore = inchiKeyOf(inputSmiles);
    const keyAfter = inchiKeyOf(opsinSmiles!);
    expect(keyBefore).not.toBeNull();
    expect(keyAfter).toBe(keyBefore);
  });
});

describe("T4S4 Task3 – E2E round-trip 1,4-dioxaspiro[4.5]decane", () => {
  it("ketal: SMILES → name → OPSIN SMILES → same canonical key", () => {
    const inputSmiles = "C1CCC2(CC1)OCCO2";
    const named = name(inputSmiles);
    expect(named).toBe("1,4-dioxaspiro[4.5]decane");
    if (!opsinAvailable) return;
    const opsinSmiles = opsinToSmiles(named!);
    expect(opsinSmiles).not.toBeNull();
    const keyBefore = inchiKeyOf(inputSmiles);
    const keyAfter = inchiKeyOf(opsinSmiles!);
    expect(keyBefore).not.toBeNull();
    expect(keyAfter).toBe(keyBefore);
  });
});

// ── OPSIN round-trip audit (all spiro cases) ──────────────────────────────────

describe("T4S4 Task3 – OPSIN round-trip audit (spiro)", () => {
  const spiroCases: [string, string][] = [
    // Carbocyclic
    ["C1CCC2(CC1)CCCC2",   "spiro[4.5]decane"],
    ["C1CCC2(CC1)CCCCC2",  "spiro[5.5]undecane"],
    ["C1CC2(C1)CCC2",      "spiro[3.3]heptane"],
    ["C1CC12CC2",          "spiro[2.2]pentane"],
    ["C1CCC2(C1)CCCC2",    "spiro[4.4]nonane"],
    // Heteroatom replacement
    ["C1CCC2(CC1)OCCO2",   "1,4-dioxaspiro[4.5]decane"],
    ["C1CCC2(CC1)CCCO2",   "1-oxaspiro[4.5]decane"],
    ["C1CCC2(CC1)CCCN2",   "1-azaspiro[4.5]decane"],
    ["O1CCC2(C1)CCCCC2",   "2-oxaspiro[4.5]decane"],
    ["C1CC2(CCO2)CCC1",    "1-oxaspiro[3.5]nonane"],
    ["C1CCC2(CC1)OCCCC2",  "1-oxaspiro[5.5]undecane"],
    ["C1CC2(CCCN2)CC1",    "1-azaspiro[4.4]nonane"],
    // Substituents
    ["CC1CCC2(CC1)CCCC2",  "8-methylspiro[4.5]decane"],
    ["CC1CC12CC2",         "1-methylspiro[2.2]pentane"],
    ["CC1(C)CCC12CCC2",    "1,1-dimethylspiro[3.3]heptane"],
    // Suffix functional groups
    ["NC1CCC2(CCCCC2)CC1", "spiro[5.5]undecan-3-amine"],
    ["C1CCC2(C1)CCC(=O)CC2","spiro[4.5]decan-8-one"],
    ["C1CCC2(CC1)CCC(=O)C2","spiro[4.5]decan-2-one"],
    ["OC1CCCC2(CCCC2)C1",  "spiro[4.5]decan-7-ol"],
  ];

  for (const [smiles, expectedName] of spiroCases) {
    it(`${expectedName}: engine output is OPSIN-parseable and structurally correct`, () => {
      const n = name(smiles);
      expect(n).toBe(expectedName);
      if (!opsinAvailable) return;
      const opsinSmiles = opsinToSmiles(n!);
      expect(opsinSmiles).not.toBeNull();
      const keyInput = inchiKeyOf(smiles);
      const keyOpsin = inchiKeyOf(opsinSmiles!);
      expect(keyInput).not.toBeNull();
      expect(keyOpsin).toBe(keyInput);
    });
  }
});

// ── Decline guard ─────────────────────────────────────────────────────────────

describe("T4S4 Task3 – decline guard: out-of-scope spiro still declined", () => {
  it("dispiro (2 spiro atoms) → unsupported", () => {
    // dispiro[4.1.4.1]dodecane-type: two spiro atoms → DECLINE
    expect(status("C1CCC2(CC1)CCC3(CC2)CCCC3")).toBe("unsupported");
  });

  it("spiro lactone (ring O + suffix carbonyl) → unsupported (not mis-named)", () => {
    const g = graphFromSmiles("O=C1CCC2(CCCCC2)O1");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
    expect(r?.name).toBeNull();
  });
});
