// tests/chem/naming/engine.audit-regressions2.test.ts
//
// Regressions found by the categorized 5000-structure audit. Each previously
// produced a WRONG name (dropped unsaturation, or tautomer-wrong azole locant);
// the engine now declines (no wrong names) while the valid neighbours still name.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function res(s: string) {
  const g = graphFromSmiles(s);
  if (!g) throw new Error(`bad smiles ${s}`);
  return nameMolecule(g);
}

describe("audit2 – alkenyl substituent on a ring now NAMES correctly (was wrong)", () => {
  it("benzene + vinyl + methyl → 1-ethenyl-2-methylbenzene (was '1-ethyl-2-methylbenzene')", () => {
    expect(res("c(C)1ccccc1C=C").name).toBe("1-ethenyl-2-methylbenzene");
  });
  it("benzene + 1-substituted vinyl → (but-1-en-1-yl)benzene (was 'butylbenzene')", () => {
    expect(res("c1ccccc1C=C(CC)").name).toBe("(but-1-en-1-yl)benzene");
  });
  it("bare styrene still names", () => {
    expect(res("C=Cc1ccccc1").name).toBe("styrene");
  });
  it("plain alkylbenzene still names", () => {
    expect(res("CCc1ccccc1").name).toBe("ethylbenzene");
  });
});

describe("audit2 – bridged/spiro ring with both unsaturation and a suffix declines", () => {
  it("norbornene-2-carboxylic acid declines (was saturated heptane-carboxylic acid)", () => {
    expect(res("C1CC2CC1C(C(=O)O)=C2").status).toBe("unsupported");
  });
  it("norbornen-ol declines", () => {
    expect(res("C1C(O)C2CC1C=C2").status).toBe("unsupported");
  });
  it("bare norbornene still names", () => {
    expect(res("C1CC2CC1C=C2").name).toBe("bicyclo[2.2.1]hept-2-ene");
  });
  it("saturated norbornane-carboxylic acid still names", () => {
    expect(res("C1CC2CCC1C2C(=O)O").name).toMatch(/bicyclo\[2\.2\.1\]heptane.*carboxylic acid/);
  });
});

describe("audit2 – substituted N-H azole (indicated-H numbering) declines", () => {
  it("methylimidazole declines (was '4-methylimidazole'; PubChem 5-methyl-1H-imidazole)", () => {
    expect(res("c(C)1cnc[nH]1").status).toBe("unsupported");
  });
  it("imidazol-yl-methanamine declines (azole as substituent)", () => {
    expect(res("c(CN)1cnc[nH]1").status).toBe("unsupported");
  });
  it("bare imidazole still names", () => {
    expect(res("c1c[nH]cn1").name).toBe("imidazole");
  });
  it("substituted pyridine (no N-H) still names", () => {
    expect(res("Cc1ccncc1").name).toBe("4-methylpyridine");
  });
});
