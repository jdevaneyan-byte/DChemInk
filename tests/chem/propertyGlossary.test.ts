import { describe, it, expect } from "vitest";
import { propertiesToRows, type MolProperties } from "@/chem/properties";
import { PROPERTY_GLOSSARY } from "@/chem/propertyGlossary";

const SAMPLE: MolProperties = {
  formula: "C9H8O4",
  molWt: 180.16,
  exactMass: 180.0423,
  cLogP: 1.31,
  molarRefractivity: 44.9,
  tpsa: 63.6,
  hbd: 1,
  hba: 3,
  rotatableBonds: 2,
  heavyAtoms: 13,
  heteroatoms: 4,
  rings: 1,
  aromaticRings: 1,
  fractionCsp3: 0.11,
  stereocenters: 0,
  amideBonds: 0,
  lipinskiHBA: 4,
  lipinskiHBD: 1,
};

describe("PROPERTY_GLOSSARY", () => {
  it("has an entry for every label returned by propertiesToRows", () => {
    for (const [label] of propertiesToRows(SAMPLE)) {
      expect(PROPERTY_GLOSSARY[label], `missing glossary entry for "${label}"`).toBeDefined();
    }
  });

  it("every entry has non-empty term/definition/method and a perMolecule sentence", () => {
    for (const label of Object.keys(PROPERTY_GLOSSARY)) {
      const entry = PROPERTY_GLOSSARY[label];
      expect(entry.term.length).toBeGreaterThan(0);
      expect(entry.definition.length).toBeGreaterThan(0);
      expect(entry.method.length).toBeGreaterThan(0);
      const sentence = entry.perMolecule(SAMPLE);
      expect(typeof sentence).toBe("string");
      expect(sentence.length).toBeGreaterThan(0);
    }
  });

  it("perMolecule references the molecule's actual value", () => {
    expect(PROPERTY_GLOSSARY["HBD"].perMolecule(SAMPLE)).toContain(String(SAMPLE.hbd));
    expect(PROPERTY_GLOSSARY["cLogP"].perMolecule(SAMPLE)).toContain(
      SAMPLE.cLogP.toFixed(2),
    );
    expect(PROPERTY_GLOSSARY["Rings"].perMolecule(SAMPLE)).toContain(String(SAMPLE.rings));
    expect(PROPERTY_GLOSSARY["Formula"].perMolecule(SAMPLE)).toContain(SAMPLE.formula);
  });

  it("perMolecule output differs for molecules with different values", () => {
    const other: MolProperties = { ...SAMPLE, hbd: 5, cLogP: -2.5 };
    expect(PROPERTY_GLOSSARY["HBD"].perMolecule(SAMPLE)).not.toBe(
      PROPERTY_GLOSSARY["HBD"].perMolecule(other),
    );
    expect(PROPERTY_GLOSSARY["cLogP"].perMolecule(SAMPLE)).not.toBe(
      PROPERTY_GLOSSARY["cLogP"].perMolecule(other),
    );
  });
});
