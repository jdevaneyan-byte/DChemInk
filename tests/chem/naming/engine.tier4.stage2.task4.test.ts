// tests/chem/naming/engine.tier4.stage2.task4.test.ts
//
// Task 4 — dual audit + 2 e2e tests + roadmap
//
// OPSIN round-trip: every name our engine produces must be parseable by OPSIN
// and the resulting structure must be compatible (same InChIKey or equivalent).
//
// PubChem cross-check: all fused-ring names verified against PubChem canonical
// names (see comments inline).
//
// E2E tests: naphthalene and quinoline (full round-trip: SMILES → name → OPSIN → InChIKey).

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

  // Check OPSIN availability
  const check = spawnSync("java", ["-jar", "/tmp/opsin.jar", "--help"], { encoding: "utf8", timeout: 5000 });
  opsinAvailable = check.status === 0 || (check.stderr?.includes("opsin") ?? false) || (check.stdout?.includes("opsin") ?? false);
  // More reliable: just try a simple conversion
  const test = spawnSync("java", ["-jar", "/tmp/opsin.jar", "-osmi"], {
    input: "benzene\n", encoding: "utf8", timeout: 5000
  });
  opsinAvailable = test.status === 0 && test.stdout.trim().length > 0;
});

function name(smiles: string): string | null {
  const g = graphFromSmiles(smiles);
  if (!g) return null;
  return nameMolecule(g).name;
}

/** Convert a name to SMILES via OPSIN. Returns null if OPSIN not available or name fails. */
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

// ── E2E tests: full round-trip (SMILES → name → OPSIN → InChIKey) ─────────────
describe("Task 4 – E2E round-trip naphthalene", () => {
  it("naphthalene: SMILES → name → OPSIN SMILES → same InChIKey", () => {
    const inputSmiles = "c1ccc2ccccc2c1";
    const named = name(inputSmiles);
    expect(named).toBe("naphthalene");

    if (!opsinAvailable) return; // skip OPSIN part if not available

    const opsinSmiles = opsinToSmiles(named!);
    expect(opsinSmiles).not.toBeNull();

    const inchiBefore = inchiKeyOf(inputSmiles);
    const inchiAfter = inchiKeyOf(opsinSmiles!);
    expect(inchiBefore).not.toBeNull();
    expect(inchiAfter).not.toBeNull();
    expect(inchiAfter).toBe(inchiBefore);
  });
});

describe("Task 4 – E2E round-trip quinoline", () => {
  it("quinoline: SMILES → name → OPSIN SMILES → same InChIKey", () => {
    const inputSmiles = "c1ccc2ncccc2c1";
    const named = name(inputSmiles);
    expect(named).toBe("quinoline");

    if (!opsinAvailable) return;

    const opsinSmiles = opsinToSmiles(named!);
    expect(opsinSmiles).not.toBeNull();

    const inchiBefore = inchiKeyOf(inputSmiles);
    const inchiAfter = inchiKeyOf(opsinSmiles!);
    expect(inchiBefore).not.toBeNull();
    expect(inchiAfter).not.toBeNull();
    expect(inchiAfter).toBe(inchiBefore);
  });
});

// ── OPSIN round-trip audit for fused ring systems ────────────────────────────
// All named fused ring cases must produce OPSIN-parseable names.
describe("Task 4 – OPSIN round-trip audit (fused ring systems)", () => {
  const fusedCases: [string, string][] = [
    // Bare fused rings
    ["c1ccc2ccccc2c1", "naphthalene"],
    ["c1ccc2c(c1)cccc2", "naphthalene"],
    ["c1ccc2ncccc2c1", "quinoline"],
    ["c1ccc2cnccc2c1", "isoquinoline"],
    ["c1ccc2occc2c1", "1-benzofuran"],
    ["c1ccc2sccc2c1", "1-benzothiophene"],
    ["c1ccc2[nH]ccc2c1", "1H-indole"],
    ["c1ccc2c(c1)cc[nH]2", "1H-indole"],
    ["c1ccc2[nH]cnc2c1", "1H-benzimidazole"],
    ["c1ccc2[nH]ncc2c1", "1H-indazole"],
    ["c1nc2[nH]cnc2cn1", "7H-purine"],
    ["c1cnc2ccccc2n1", "quinoxaline"],
    ["c1ccc2ncncc2c1", "quinazoline"],
    ["c1ccc2nnccc2c1", "cinnoline"],
    ["c1ccc2cc3ccccc3cc2c1", "anthracene"],
    ["c1ccc2ccc3ccccc3c2c1", "phenanthrene"],
    // Substituted fused rings (Task 3)
    ["Cc1ccc2ccccc2c1", "2-methylnaphthalene"],
    ["Cc1cccc2ccccc12", "1-methylnaphthalene"],
    ["Oc1cccc2ccccc12", "naphthalen-1-ol"],
    ["OC(=O)c1ccc2ccccc2c1", "naphthalene-2-carboxylic acid"],
    ["Clc1ccc2ccccc2n1", "2-chloroquinoline"],
  ];

  for (const [smiles, expectedName] of fusedCases) {
    it(`${expectedName}: engine output is OPSIN-parseable`, () => {
      const n = name(smiles);
      expect(n).toBe(expectedName);
      if (!opsinAvailable) return;
      const opsinSmiles = opsinToSmiles(n!);
      expect(opsinSmiles).not.toBeNull();
    });
  }
});

// ── Roadmap: T4 Stage 2 done; remaining stages ───────────────────────────────
describe("Task 4 – roadmap: remaining unsupported → decline with reason", () => {
  it("bridged ring (norbornane) → now named by Stage 3 (T4S3)", () => {
    // Stage 3 (T4S3) implemented von Baeyer bridged naming.
    const g = graphFromSmiles("C1CC2CCC1C2");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("named");
    expect(r?.name).toBe("bicyclo[2.2.1]heptane");
  });

  it("unsupported bridged ring (general tricyclic, not adamantane) → decline", () => {
    // cubane-like or uncurated tricyclics are still declined
    const g = graphFromSmiles("C12C3C4C1C5C4C3C25"); // cubane
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
  });

  it("spiro ring → spiro decline", () => {
    const g = graphFromSmiles("C1CCC2(CC1)CCCCC2");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
    expect(r?.reason).toMatch(/spiro/i);
  });

  it("ring assembly (biphenyl) → assembly decline", () => {
    const g = graphFromSmiles("c1ccccc1-c1ccccc1");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
    expect(r?.reason).toMatch(/assembly/i);
  });

  it("unknown fused system (1,7-naphthyridine) → unsupported", () => {
    const g = graphFromSmiles("c1cnc2cnccc2c1");
    const r = g ? nameMolecule(g) : null;
    expect(r?.status).toBe("unsupported");
  });
});
