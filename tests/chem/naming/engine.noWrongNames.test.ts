// tests/chem/naming/engine.noWrongNames.test.ts
//
// Regression suite for the "NO WRONG NAMES" invariant: when the engine cannot
// correctly name a structure it MUST decline (status "unsupported") rather than
// emit a name that drops atoms or uses a non-IUPAC prefix.
//
// Three classes from the 20k-structure audit:
//   CLASS 1 — ring-containing substituent on a chain parent (was silently dropped)
//   CLASS 2 — acid-derivative group (acylHalide/ester/anhydride) demoted to a prefix
//   CLASS 3 — substituent on an aromatic ring heteroatom implying hypervalence/charge

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

describe("CLASS 1 — ring-containing substituent on a chain parent must decline", () => {
  it("CC(C)(C)C(Cc1ccccc1)C(=O)O declines (benzyl must not be dropped)", () => {
    expect(status("CC(C)(C)C(Cc1ccccc1)C(=O)O")).toBe("unsupported");
  });

  it("CC(CO)Cc1ccccc1 declines (benzyl must not be dropped)", () => {
    expect(status("CC(CO)Cc1ccccc1")).toBe("unsupported");
  });

  // Must STILL work — ring as direct substituent / ring as parent.
  it("OC(=O)Cc1ccccc1 → 2-phenylethanoic acid (ring as direct substituent still works)", () => {
    expect(name("OC(=O)Cc1ccccc1")).toBe("2-phenylethanoic acid");
  });
  it("OCc1ccccc1 → phenylmethanol still works", () => {
    expect(name("OCc1ccccc1")).toBe("phenylmethanol");
  });
  it("CCCC1CCCCC1 → propylcyclohexane (ring as parent still works)", () => {
    expect(name("CCCC1CCCCC1")).toBe("propylcyclohexane");
  });
  it("CCCCC1CCCCC1 → butylcyclohexane still works", () => {
    expect(name("CCCCC1CCCCC1")).toBe("butylcyclohexane");
  });
});

describe("CLASS 2 — acid derivative demoted to prefix must decline", () => {
  it("COC(C(=O)O)C(=O)F declines (no bogus 'haloformyl' prefix)", () => {
    expect(status("COC(C(=O)O)C(=O)F")).toBe("unsupported");
  });

  // Must STILL work — these ARE the principal group.
  it("CC(=O)Cl → ethanoyl chloride still works", () => {
    expect(name("CC(=O)Cl")).toBe("ethanoyl chloride");
  });
  it("CC(=O)OCC → ethyl ethanoate still works", () => {
    expect(name("CC(=O)OCC")).toBe("ethyl ethanoate");
  });
});

describe("CLASS 3 — substituent on aromatic ring heteroatom implying hypervalence must decline", () => {
  it("CCN1C=CS(CC)=C1 declines", () => {
    expect(status("CCN1C=CS(CC)=C1")).toBe("unsupported");
  });
  it("CN1C=CS(C)=C1 declines", () => {
    expect(status("CN1C=CS(C)=C1")).toBe("unsupported");
  });

  // Must STILL work — legitimate single substituent on pyrrole-type NH nitrogen.
  it("Cn1cccc1 → 1-methylpyrrole still works", () => {
    expect(name("Cn1cccc1")).toBe("1-methylpyrrole");
  });
  it("c1ccncc1 → pyridine still works", () => {
    expect(name("c1ccncc1")).toBe("pyridine");
  });
  it("Cc1ccccn1 → 2-methylpyridine still works", () => {
    expect(name("Cc1ccccn1")).toBe("2-methylpyridine");
  });
  it("c1ccoc1 → furan still works", () => {
    expect(name("c1ccoc1")).toBe("furan");
  });
});
