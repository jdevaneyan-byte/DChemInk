// tests/chem/naming/engine.tier4.cyclic-carbonyls.test.ts
//
// Task 1 – Tier 4, Stage 1: saturated lactams / lactones
// Task 2 – Tier 4, Stage 1: aromatic ring carbonyls (indicated-H or DECLINE)
//
// All PubChem-verified (2026-05-24):
//   O=C1CCCN1   → pyrrolidin-2-one    ✓
//   O=C1CCCCN1  → piperidin-2-one     ✓
//   O=C1CCCCCN1 → azepan-2-one        ✓
//   O=C1CCN1    → azetidin-2-one      ✓
//   O=C1CCCO1   → oxolan-2-one        ✓
//   O=C1CCCCO1  → oxan-2-one          ✓
//   O=C1CCO1    → oxetan-2-one        ✓
// Regression:
//   O=C1CCCCC1  → cyclohexanone       (T3 carbocyclic ketone, unchanged)
//   C1CCNCC1    → piperidine          (no carbonyl, unchanged)
//
// Task 2 – aromatic ring carbonyls (PubChem says "1H-pyridin-2-one" for the PIN;
//   IUPAC 2013 prefers the locant-suffix form "pyridin-2(1H)-one" as the PIN.
//   We emit the locant-suffix form: pyridin-2(1H)-one. OPSIN parses both.):
//   O=C1C=CC=CN1 / O=c1cccc[nH]1  → pyridin-2(1H)-one
//   O=c1cc[nH]cc1                  → pyridin-4(1H)-one
//   O=c1cccco1                     → 2H-pyran-2-one (or pyran-2-one — DECLINE acceptable)
//   O=c1cc[nH]c(=O)[nH]1          → pyrimidine-2,4(1H,3H)-dione (uracil)
//
// Note: if an aromatic ring-carbonyl case cannot be reliably computed with
// indicated-H that OPSIN-round-trips, it DECLINES (status: "unsupported").
// This file tests the cases we DO support. Un-supported cases get status checks.

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

// ── Task 1: Saturated lactams ─────────────────────────────────────────────────
describe("Tier 4 Stage 1 – saturated lactams", () => {
  it("O=C1CCCN1 → pyrrolidin-2-one", () => {
    expect(name("O=C1CCCN1")).toBe("pyrrolidin-2-one");
  });

  it("O=C1CCCCN1 → piperidin-2-one", () => {
    expect(name("O=C1CCCCN1")).toBe("piperidin-2-one");
  });

  it("O=C1CCCCCN1 → azepan-2-one", () => {
    expect(name("O=C1CCCCCN1")).toBe("azepan-2-one");
  });

  it("O=C1CCN1 → azetidin-2-one", () => {
    expect(name("O=C1CCN1")).toBe("azetidin-2-one");
  });
});

// ── Task 1: Saturated lactones ────────────────────────────────────────────────
describe("Tier 4 Stage 1 – saturated lactones", () => {
  it("O=C1CCCO1 → oxolan-2-one (γ-butyrolactone)", () => {
    expect(name("O=C1CCCO1")).toBe("oxolan-2-one");
  });

  it("O=C1CCCCO1 → oxan-2-one", () => {
    expect(name("O=C1CCCCO1")).toBe("oxan-2-one");
  });

  it("O=C1CCO1 → oxetan-2-one", () => {
    expect(name("O=C1CCO1")).toBe("oxetan-2-one");
  });
});

// ── Task 1: Regression – T3 still works ──────────────────────────────────────
describe("Tier 4 Stage 1 – regression: T1–T3 unchanged", () => {
  it("O=C1CCCCC1 → cyclohexanone (T3 carbocyclic ketone, unchanged)", () => {
    expect(name("O=C1CCCCC1")).toBe("cyclohexanone");
  });

  it("C1CCNCC1 → piperidine (T3 heterocycle, no carbonyl)", () => {
    expect(name("C1CCNCC1")).toBe("piperidine");
  });
});

// ── Task 2: Aromatic ring carbonyls (indicated H) ─────────────────────────────
// These are either named with indicated H OR declined (never mis-named).
describe("Tier 4 Stage 1 – aromatic ring carbonyls", () => {
  it("O=C1C=CC=CN1 (Kekulé pyridin-2-one) → pyridin-2(1H)-one or declined", () => {
    const n = name("O=C1C=CC=CN1");
    // Must either be the correct name or null (declined); never a wrong name.
    if (n !== null) {
      expect(n).toBe("pyridin-2(1H)-one");
    } else {
      expect(status("O=C1C=CC=CN1")).toBe("unsupported");
    }
  });

  it("O=c1cccc[nH]1 (aromatic pyridin-2-one) → pyridin-2(1H)-one or declined", () => {
    const n = name("O=c1cccc[nH]1");
    if (n !== null) {
      expect(n).toBe("pyridin-2(1H)-one");
    } else {
      expect(status("O=c1cccc[nH]1")).toBe("unsupported");
    }
  });

  it("O=c1cc[nH]cc1 (pyridin-4-one) → pyridin-4(1H)-one or declined", () => {
    const n = name("O=c1cc[nH]cc1");
    if (n !== null) {
      expect(n).toBe("pyridin-4(1H)-one");
    } else {
      expect(status("O=c1cc[nH]cc1")).toBe("unsupported");
    }
  });

  it("uracil O=c1cc[nH]c(=O)[nH]1 → pyrimidine-2,4(1H,3H)-dione or declined", () => {
    const n = name("O=c1cc[nH]c(=O)[nH]1");
    if (n !== null) {
      expect(n).toBe("pyrimidine-2,4(1H,3H)-dione");
    } else {
      expect(status("O=c1cc[nH]c(=O)[nH]1")).toBe("unsupported");
    }
  });

  // 2H-pyran-2-one: the ring O does not carry H in the SMILES, so aromatic detection
  // depends on RDKit's Kekulization. This case may or may not be supported.
  it("O=c1cccco1 (2H-pyran-2-one) → 2H-pyran-2-one or declined", () => {
    const n = name("O=c1cccco1");
    if (n !== null) {
      expect(n).toBe("2H-pyran-2-one");
    } else {
      expect(status("O=c1cccco1")).toBe("unsupported");
    }
  });
});
