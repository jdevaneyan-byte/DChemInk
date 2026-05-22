// src/chem/naming/verify.ts
import { parseSmiles } from "../rdkit";

export interface NameVerifier {
  /** True iff `name` parses back to a structure with the given stable key. */
  verify(name: string, targetKey: string): Promise<boolean>;
}

/**
 * Stable structural key for a SMILES string.
 *
 * NOTE: RDKit MinimalLib 2025.3.4 does NOT expose get_inchikey(). We use
 * canonical SMILES from get_smiles() as the stable key — it is normalised by
 * RDKit and therefore equal across equivalent SMILES representations.
 * The exported name `inchiKeyOf` is kept for interface stability; callers
 * should treat the return value as an opaque string, not a literal InChIKey.
 *
 * @returns Canonical SMILES string on success, null on failure.
 */
export function inchiKeyOf(smiles: string): string | null {
  const mol = parseSmiles(smiles);
  if (!mol) return null;
  try {
    const canonical = mol.get_smiles();
    return canonical && canonical.length > 0 ? canonical : null;
  } finally {
    mol.delete();
  }
}

/** Fallback verifier used when OPSIN is unavailable: never asserts correctness.
 *
 * opsin-js is not in the npm registry (probe: pnpm add -D opsin-js → 404).
 * The runtime "✓ verified" badge is deferred until an OPSIN JS build is available.
 * The engine's correctness is covered by the Task 6 test corpus.
 */
export const nullVerifier: NameVerifier = {
  async verify() {
    return false;
  },
};

// defaultVerifier is nullVerifier since OPSIN is not available.
// When opsin-js becomes available, wire an opsinVerifier here that:
//   1. parses `name` -> SMILES via OPSIN,
//   2. computes inchiKeyOf(thatSmiles),
//   3. returns it === targetKey.
export const defaultVerifier: NameVerifier = nullVerifier;
