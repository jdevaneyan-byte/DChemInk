import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { nullVerifier, inchiKeyOf } from "@/chem/naming/verify";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

describe("inchiKeyOf", () => {
  it("computes a stable InChIKey for a SMILES", () => {
    const a = inchiKeyOf("CCCC");
    const b = inchiKeyOf("C(C)CC");
    expect(a).not.toBeNull();
    expect(a).toBe(b); // same molecule, different SMILES
  });
});

describe("nullVerifier", () => {
  it("never claims verification", async () => {
    expect(await nullVerifier.verify("butane", "DUMMY")).toBe(false);
  });
});
