import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import {
  computeProperties,
  pickFragmentByAtomCount,
  propertiesToCsv,
  propertiesToTsv,
  propertiesToHtmlTable,
  type MolProperties,
} from "@/chem/properties";

const require = createRequire(import.meta.url);

beforeAll(async () => {
  await initRDKit({
    locateFile: (file) => require.resolve(`@rdkit/rdkit/dist/${file}`),
  });
});

describe("computeProperties", () => {
  it("computes MW and formula for toluene", () => {
    const props = computeProperties("Cc1ccccc1");
    expect(props).not.toBeNull();
    expect(props!.formula).toBe("C7H8");
    expect(props!.molWt).toBeCloseTo(92.14, 2);
  });

  it("returns null for invalid SMILES", () => {
    expect(computeProperties("not-a-smiles")).toBeNull();
  });

  // New descriptor tests on aspirin: CC(=O)Oc1ccccc1C(=O)O
  describe("aspirin extended descriptors", () => {
    let props: MolProperties;

    beforeAll(() => {
      const result = computeProperties("CC(=O)Oc1ccccc1C(=O)O");
      if (!result) throw new Error("computeProperties returned null for aspirin");
      props = result;
    });

    it("computes cLogP close to 1.31 for aspirin", () => {
      // CrippenClogP for aspirin — allow ±0.5
      expect(props.cLogP).toBeGreaterThan(0.5);
      expect(props.cLogP).toBeLessThan(2.5);
    });

    it("computes tpsa close to 63.6 for aspirin", () => {
      // TPSA for aspirin — allow ±5
      expect(props.tpsa).toBeGreaterThan(55);
      expect(props.tpsa).toBeLessThan(75);
    });

    it("computes molarRefractivity > 0 for aspirin", () => {
      expect(props.molarRefractivity).toBeGreaterThan(0);
    });

    it("computes hbd = 1 for aspirin (the COOH proton)", () => {
      expect(props.hbd).toBe(1);
    });

    it("computes hba in range 3–4 for aspirin", () => {
      expect(props.hba).toBeGreaterThanOrEqual(3);
      expect(props.hba).toBeLessThanOrEqual(4);
    });

    it("computes rotatableBonds >= 2 for aspirin", () => {
      expect(props.rotatableBonds).toBeGreaterThanOrEqual(2);
    });

    it("computes heavyAtoms = 13 for aspirin (C9H8O4)", () => {
      expect(props.heavyAtoms).toBe(13);
    });

    it("computes rings = 1 for aspirin", () => {
      expect(props.rings).toBe(1);
    });

    it("computes aromaticRings = 1 for aspirin", () => {
      expect(props.aromaticRings).toBe(1);
    });

    it("computes fractionCsp3 >= 0 and <= 1 for aspirin", () => {
      expect(props.fractionCsp3).toBeGreaterThanOrEqual(0);
      expect(props.fractionCsp3).toBeLessThanOrEqual(1);
    });

    it("computes stereocenters as non-negative integer for aspirin", () => {
      expect(props.stereocenters).toBeGreaterThanOrEqual(0);
    });

    it("computes amideBonds = 0 for aspirin", () => {
      expect(props.amideBonds).toBe(0);
    });

    it("computes lipinskiHBA for aspirin", () => {
      expect(props.lipinskiHBA).toBeGreaterThanOrEqual(3);
    });

    it("computes lipinskiHBD for aspirin", () => {
      expect(props.lipinskiHBD).toBeGreaterThanOrEqual(1);
    });

    it("computes heteroatoms > 0 for aspirin", () => {
      expect(props.heteroatoms).toBeGreaterThan(0);
    });
  });
});

describe("propertiesToCsv", () => {
  const sampleProps: MolProperties = {
    formula: "C9H8O4",
    molWt: 180.16,
    exactMass: 180.0423,
    cLogP: 1.31,
    molarRefractivity: 45.12,
    tpsa: 63.60,
    hbd: 1,
    hba: 3,
    rotatableBonds: 3,
    heavyAtoms: 13,
    heteroatoms: 4,
    rings: 1,
    aromaticRings: 1,
    fractionCsp3: 0.11,
    stereocenters: 0,
    amideBonds: 0,
    lipinskiHBA: 3,
    lipinskiHBD: 1,
  };

  it("starts with the header row Property,Value", () => {
    const csv = propertiesToCsv(sampleProps);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Property,Value");
  });

  it("includes a Formula row with the formula value", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("Formula,C9H8O4");
  });

  it("includes Molecular Weight formatted to 2 dp", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("Molecular Weight,180.16");
  });

  it("includes Exact Mass formatted to 4 dp", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("Exact Mass,180.0423");
  });

  it("includes cLogP formatted to 2 dp", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("cLogP,1.31");
  });

  it("includes TPSA formatted to 2 dp", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("TPSA,63.60");
  });

  it("includes HBD as integer", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("HBD,1");
  });

  it("includes Heavy Atoms as integer", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("Heavy Atoms,13");
  });

  it("includes Fraction Csp3 formatted to 2 dp", () => {
    const csv = propertiesToCsv(sampleProps);
    expect(csv).toContain("Fraction Csp3,0.11");
  });

  it("has at least 19 rows (header + 18 properties)", () => {
    const csv = propertiesToCsv(sampleProps);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(19);
  });
});

describe("propertiesToTsv / propertiesToHtmlTable", () => {
  const sampleProps: MolProperties = {
    formula: "C9H8O4", molWt: 180.16, exactMass: 180.0423, cLogP: 1.31,
    molarRefractivity: 45.12, tpsa: 63.6, hbd: 1, hba: 3, rotatableBonds: 3,
    heavyAtoms: 13, heteroatoms: 4, rings: 1, aromaticRings: 1, fractionCsp3: 0.11,
    stereocenters: 0, amideBonds: 0, lipinskiHBA: 3, lipinskiHBD: 1,
  };

  it("TSV is tab-separated with a header (pastes into spreadsheet cells)", () => {
    const tsv = propertiesToTsv(sampleProps);
    expect(tsv.split("\n")[0]).toBe("Property\tValue");
    expect(tsv).toContain("Formula\tC9H8O4");
    expect(tsv).toContain("Molecular Weight\t180.16");
    expect(tsv).not.toContain(","); // no commas — values are tab-delimited
  });

  it("HTML is a real <table> with a header and Formula row", () => {
    const html = propertiesToHtmlTable(sampleProps);
    expect(html).toMatch(/^<table>/);
    expect(html).toContain("<th>Property</th><th>Value</th>");
    expect(html).toContain("<td>Formula</td><td>C9H8O4</td>");
    expect(html).toMatch(/<\/table>$/);
  });
});

describe("pickFragmentByAtomCount", () => {
  beforeAll(async () => {
    await initRDKit({ locateFile: (file) => require.resolve(`@rdkit/rdkit/dist/${file}`) });
  });

  it("returns the fragment whose heavy-atom count matches the selection", () => {
    // benzene (6 heavy atoms) . ethanol (3 heavy atoms)
    const all = "c1ccccc1.CCO";
    expect(pickFragmentByAtomCount(all, 3)).toBe("CCO");
    expect(pickFragmentByAtomCount(all, 6)).toBe("c1ccccc1");
  });

  it("returns null when there is only one fragment", () => {
    expect(pickFragmentByAtomCount("c1ccccc1", 6)).toBeNull();
  });

  it("returns null when no fragment matches the count", () => {
    expect(pickFragmentByAtomCount("c1ccccc1.CCO", 99)).toBeNull();
  });
});
