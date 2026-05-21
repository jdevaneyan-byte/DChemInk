import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit, parseSmiles } from "@/chem/rdkit";

const require = createRequire(import.meta.url);

beforeAll(async () => {
  await initRDKit({
    locateFile: (file) => require.resolve(`@rdkit/rdkit/dist/${file}`),
  });
});

describe("rdkit", () => {
  it("parses a valid SMILES and returns a molecule", () => {
    const mol = parseSmiles("Cc1ccccc1"); // toluene
    expect(mol).not.toBeNull();
    expect(mol!.is_valid()).toBe(true);
    mol!.delete();
  });

  it("round-trips toluene canonical SMILES", () => {
    const mol = parseSmiles("Cc1ccccc1")!;
    expect(mol.get_smiles()).toBe("Cc1ccccc1");
    mol.delete();
  });

  it("returns null for invalid SMILES", () => {
    expect(parseSmiles("not-a-smiles")).toBeNull();
  });

  it("returns null for empty SMILES", () => {
    expect(parseSmiles("")).toBeNull();
  });

  it("returns null for whitespace-only SMILES", () => {
    expect(parseSmiles("   ")).toBeNull();
  });
});
