// tests/chem/naming/engine.tier4.stage5.hantzschwidman.test.ts
//
// T4 Stage 5 Task 2 — algorithmic Hantzsch–Widman naming for SATURATED
// monocyclic heterocycles not in the curated retained table. All names
// PubChem-verified and OPSIN round-trip confirmed.

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

describe("T4S5 – Hantzsch–Widman saturated O/S heterocycles", () => {
  const cases: [string, string][] = [
    ["C1COCO1", "1,3-dioxolane"],
    ["C1COCOC1", "1,3-dioxane"],
    ["C1COCCO1", "1,4-dioxane"],
    ["C1CSCS1", "1,3-dithiolane"],
    ["C1CSCSC1", "1,3-dithiane"],
    ["C1OCOCO1", "1,3,5-trioxane"],
    ["C1OCCOCC1", "1,4-dioxepane"],
    ["C1OCOCCC1", "1,3-dioxepane"],
    ["C1OCOCCCC1", "1,3-dioxocane"],
    ["C1CCCOCCC1", "oxocane"],
    ["C1CCCSCCC1", "thiocane"],
  ];
  for (const [smi, n] of cases) it(`${smi} → ${n}`, () => expect(name(smi)).toBe(n));
});

describe("T4S5 – Hantzsch–Widman with nitrogen (oxa/thia/aza stems)", () => {
  const cases: [string, string][] = [
    ["C1COCN1", "1,3-oxazolidine"],
    ["C1CONC1", "1,2-oxazolidine"],
    ["C1COCNC1", "1,3-oxazinane"],
    ["C1COCCS1", "1,4-oxathiane"],
    ["C1COCCNC1", "1,4-oxazepane"],
    ["C1NCNCN1", "1,3,5-triazinane"],
    ["C1NCNCC1", "1,3-diazinane"],
    ["C1CCCNCCC1", "azocane"],
  ];
  for (const [smi, n] of cases) it(`${smi} → ${n}`, () => expect(name(smi)).toBe(n));
});

describe("T4S5 – retained saturated names (not HW-generated)", () => {
  it("imidazolidine (not 1,3-diazolidine)", () => expect(name("C1CNCN1")).toBe("imidazolidine"));
  it("pyrazolidine (not 1,2-diazolidine)", () => expect(name("C1CNNC1")).toBe("pyrazolidine"));
  it("thiomorpholine (not 1,4-thiazinane)", () => expect(name("C1CSCCN1")).toBe("thiomorpholine"));
});

describe("T4S5 – substituents on HW rings", () => {
  it("2-methyl-1,3-dioxolane", () => expect(name("CC1OCCO1")).toBe("2-methyl-1,3-dioxolane"));
});

describe("T4S5 – unsaturated/indicated-H heterocycles still decline (no wrong names)", () => {
  it("2H-pyran declines (not oxa-2,4-diene)", () => {
    const g = graphFromSmiles("C1=CC=CCO1")!;
    expect(nameMolecule(g).status).toBe("unsupported");
  });
  it("2,3-dihydrofuran declines", () => {
    const g = graphFromSmiles("C1CC=CO1")!;
    expect(nameMolecule(g).status).toBe("unsupported");
  });
});
