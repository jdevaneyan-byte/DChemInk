import { parseSmiles } from "./rdkit";

/**
 * Remembers the name a structure was created from (Name box / paste), keyed by
 * its RDKit-canonical SMILES so the Properties panel can show the name back —
 * even though Ketcher's `getSmiles()` returns a differently-written (but
 * equivalent) SMILES than the resolver did.
 */
const names = new Map<string, string>();

/** Canonicalise via RDKit so equivalent SMILES map to the same key. */
function canonical(smiles: string): string {
  try {
    const mol = parseSmiles(smiles) as (ReturnType<typeof parseSmiles> & {
      get_smiles?: () => string;
    }) | null;
    if (mol) {
      const c = mol.get_smiles?.();
      mol.delete();
      if (c) return c;
    }
  } catch {
    // RDKit not ready / invalid — fall back to the raw string.
  }
  return smiles;
}

/** Record that `smiles` was drawn from `name`. */
export function registerName(smiles: string, name: string): void {
  const n = name.trim();
  if (!smiles || !n) return;
  names.set(canonical(smiles), n);
}

/** The name `smiles` was drawn from, or null if unknown. */
export function lookupName(smiles: string): string | null {
  if (!smiles) return null;
  return names.get(canonical(smiles)) ?? null;
}
