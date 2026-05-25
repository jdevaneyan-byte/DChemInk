// tests/chem/naming/engine.audit-regressions.test.ts
//
// Regressions found by the 5000-structure OPSIN round-trip audit. Each case
// previously produced a WRONG or malformed (OPSIN-unparseable) name; the engine
// now either names them correctly or declines (no wrong names).

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";
import { nameMolecule } from "@/chem/naming/engine";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

function res(smiles: string) {
  const g = graphFromSmiles(smiles);
  if (!g) throw new Error(`graphFromSmiles failed: ${smiles}`);
  return nameMolecule(g);
}

describe("audit regression – unsaturated ring used as substituent", () => {
  // Was named "cyclohexylmethanol", silently dropping the ring C=C → wrong structure.
  it("cyclohexenyl-methanol declines (unsaturated ring substituent)", () => {
    const r = res("C(CO)1=CCCCC1");
    expect(r.name).toBeNull();
    expect(r.status).toBe("unsupported");
  });
  // Saturated carbocyclic substituent stays correct (attachment is locant 1).
  it("saturated cyclohexyl substituent still names correctly", () => {
    expect(res("OCC1CCCCC1").name).toBe("cyclohexylmethanol");
  });
});

describe("audit regression – substituent on a ring-fusion atom", () => {
  // Was named "9-methyl…"/"9,10-…" (invalid numeric locants for fusion carbons).
  it("methyls on quinoline fusion carbons decline", () => {
    const r = res("c1ccc(C)2ncccc(C)2c1");
    expect(r.name).toBeNull();
    expect(r.status).toBe("unsupported");
  });
});

describe("audit regression – acyl halide on a ring-substituent chain", () => {
  // Was "cyclohexylmethaneundefined" (toSuffixKind has no acylHalide mapping).
  it("cyclohexanecarbonyl chloride pattern declines", () => {
    const r = res("C1CC(C(Cl)=O)CCC1");
    expect(r.name).toBeNull();
    expect(r.status).toBe("unsupported");
  });
});

describe("audit regression – di/tri multiplier on added-carbon suffix", () => {
  // Was "spiro[5.5]undecane-1,9-carbaldehyde" (missing "di") → OPSIN-unparseable.
  it("spiro dialdehyde gets the di multiplier", () => {
    expect(res("C1CCC2(C(C=O)C1)CCC(C=O)CC2").name).toBe("spiro[5.5]undecane-1,9-dicarbaldehyde");
  });
  it("bicyclo gem-dialdehyde gets the di multiplier", () => {
    expect(res("C1C(C=O)(C=O)C2CCC1CC2").name).toBe("bicyclo[2.2.2]octane-2,2-dicarbaldehyde");
  });
  it("azaspiro dinitrile gets the di multiplier", () => {
    expect(res("C(C#N)1CCC2(CC(C#N)1)CCCN2").name).toBe("1-azaspiro[4.5]decane-7,8-dicarbonitrile");
  });
});
