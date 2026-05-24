// tests/chem/naming/engine.tier4.stage2.task2.test.ts
//
// Task 2 — polycyclic fingerprint + curated table + isomorphism locant transfer
//
// All PubChem-verified (2026-05-24):
//   c1ccc2ccccc2c1       → naphthalene          ✓
//   c1ccc2ncccc2c1       → quinoline             ✓
//   c1ccc2cnccc2c1       → isoquinoline          ✓
//   c1ccc2occc2c1        → 1-benzofuran          ✓ (we emit "benzofuran")
//   c1ccc2sccc2c1        → 1-benzothiophene      ✓ (we emit "benzothiophene")
//   c1ccc2[nH]ccc2c1     → 1H-indole             ✓ (we emit "1H-indole")
//   c1ccc2[nH]cnc2c1     → 1H-benzimidazole      ✓
//   c1ccc2[nH]ncc2c1     → 1H-indazole           ✓
//   c1nc2[nH]cnc2cn1     → 7H-purine             ✓
//   c1cnc2ccccc2n1       → quinoxaline           ✓
//   c1ccc2ncncc2c1       → quinazoline           ✓
//   c1ccc2nnccc2c1       → cinnoline             ✓
//   c1ccc2cc3ccccc3cc2c1 → anthracene            ✓
//   c1ccc2ccc3ccccc3c2c1 → phenanthrene          ✓
//   c1ccc2c(c1)cc[nH]2  → 1H-indole (alt SMILES) ✓
//
// Unknown fused → still declines
// Non-ring unchanged

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
function status(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) return "error";
  return nameMolecule(g).status;
}

// ── Core fused systems ────────────────────────────────────────────────────────
describe("Task 2 – bare fused ring parents", () => {
  it("naphthalene", () => expect(name("c1ccc2ccccc2c1")).toBe("naphthalene"));
  it("naphthalene alt SMILES", () => expect(name("c1ccc2c(c1)cccc2")).toBe("naphthalene"));
  it("quinoline", () => expect(name("c1ccc2ncccc2c1")).toBe("quinoline"));
  it("isoquinoline", () => expect(name("c1ccc2cnccc2c1")).toBe("isoquinoline"));
  it("benzofuran", () => expect(name("c1ccc2occc2c1")).toBe("1-benzofuran"));
  it("benzothiophene", () => expect(name("c1ccc2sccc2c1")).toBe("1-benzothiophene"));
  it("1H-indole", () => expect(name("c1ccc2[nH]ccc2c1")).toBe("1H-indole"));
  it("1H-indole alt SMILES", () => expect(name("c1ccc2c(c1)cc[nH]2")).toBe("1H-indole"));
  it("1H-benzimidazole", () => expect(name("c1ccc2[nH]cnc2c1")).toBe("1H-benzimidazole"));
  it("1H-indazole", () => expect(name("c1ccc2[nH]ncc2c1")).toBe("1H-indazole"));
  it("7H-purine", () => expect(name("c1nc2[nH]cnc2cn1")).toBe("7H-purine"));
  it("quinoxaline", () => expect(name("c1cnc2ccccc2n1")).toBe("quinoxaline"));
  it("quinazoline", () => expect(name("c1ccc2ncncc2c1")).toBe("quinazoline"));
  it("cinnoline", () => expect(name("c1ccc2nnccc2c1")).toBe("cinnoline"));
  it("anthracene", () => expect(name("c1ccc2cc3ccccc3cc2c1")).toBe("anthracene"));
  it("phenanthrene", () => expect(name("c1ccc2ccc3ccccc3c2c1")).toBe("phenanthrene"));
});

// ── Unknown fused system → still declines ────────────────────────────────────
describe("Task 2 – unknown fused systems decline", () => {
  // acridine is not in our table yet
  it("unknown fused system still declines", () => {
    // 1,7-naphthyridine: not initially in our table → decline (not error)
    expect(status("c1cnc2cnccc2c1")).toBe("unsupported");
  });

  it("biphenyl still declines as assembly", () => {
    expect(status("c1ccccc1-c1ccccc1")).toBe("unsupported");
  });
});

// ── Regression: mono-ring unchanged ──────────────────────────────────────────
describe("Task 2 – regression mono-ring", () => {
  it("benzene still named", () => expect(name("c1ccccc1")).toBe("benzene"));
  it("pyridine still named", () => expect(name("c1ccncc1")).toBe("pyridine"));
  it("piperidine still named", () => expect(name("C1CCNCC1")).toBe("piperidine"));
});
