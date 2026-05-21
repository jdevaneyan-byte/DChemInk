import { describe, it, expect } from "vitest";
import { classifyPaste } from "@/chem/pasteRoute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub that always says the string is a valid SMILES. */
const alwaysValid = () => true;

/** Stub that always says the string is NOT a valid SMILES. */
const alwaysInvalid = () => false;

// ---------------------------------------------------------------------------
// classifyPaste
// ---------------------------------------------------------------------------

describe("classifyPaste", () => {
  // --- empty ---
  it('returns "empty" for an empty string', () => {
    expect(classifyPaste("", alwaysValid)).toBe("empty");
  });

  it('returns "empty" for a whitespace-only string', () => {
    expect(classifyPaste("   \n\t  ", alwaysValid)).toBe("empty");
  });

  // --- MOL / SDF blocks ---
  it('returns "structure" for a V2000 mol block', () => {
    const molBlock = `
  Mrv0541 01012300002D

  3  2  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5981    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
M  END
`;
    expect(classifyPaste(molBlock, alwaysInvalid)).toBe("structure");
  });

  it('returns "structure" for a V3000 mol block', () => {
    const molBlock = `

  0  0  0  0  0  0            999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 3 2 0 0 0
M  V30 END CTAB
M  END
`;
    expect(classifyPaste(molBlock, alwaysInvalid)).toBe("structure");
  });

  it('returns "structure" for a mol block identified by M  END alone', () => {
    // Some exporters omit the version stamp but always write M  END.
    const molBlock = "some header\n\nsome atoms\nM  END";
    expect(classifyPaste(molBlock, alwaysInvalid)).toBe("structure");
  });

  // --- InChI ---
  it('returns "structure" for an InChI string', () => {
    expect(
      classifyPaste(
        "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)",
        alwaysInvalid,
      ),
    ).toBe("structure");
  });

  it('returns "structure" for an InChI string with leading whitespace', () => {
    expect(
      classifyPaste("  InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3", alwaysInvalid),
    ).toBe("structure");
  });

  // --- SMILES (via injected validator) ---
  it('returns "structure" when isValidSmiles returns true', () => {
    expect(classifyPaste("CC(=O)Oc1ccccc1C(=O)O", alwaysValid)).toBe("structure");
  });

  it('returns "name" for a valid-looking SMILES when isValidSmiles returns false', () => {
    // Verify the injected validator is actually called (not bypassed).
    expect(classifyPaste("CC(=O)Oc1ccccc1C(=O)O", alwaysInvalid)).toBe("name");
  });

  // --- Chemical names ---
  it('returns "name" for the word "aspirin" when isValidSmiles returns false', () => {
    expect(classifyPaste("aspirin", alwaysInvalid)).toBe("name");
  });

  it('returns "name" for a multiword name when isValidSmiles returns false', () => {
    expect(classifyPaste("acetylsalicylic acid", alwaysInvalid)).toBe("name");
  });

  it('returns "name" for a name with surrounding whitespace when isValidSmiles returns false', () => {
    expect(classifyPaste("  caffeine  ", alwaysInvalid)).toBe("name");
  });
});
