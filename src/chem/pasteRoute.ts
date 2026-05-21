/**
 * Classify pasted text to decide whether to send it directly to Ketcher
 * (as a structure: SMILES / MOL / InChI) or route it through the name
 * resolver first.
 *
 * The `isValidSmiles` callback is injected so this module stays pure and
 * unit-testable without requiring a live RDKit WASM instance.
 */

export type PasteKind = "structure" | "name" | "empty";

/**
 * Classify a pasted string.
 *
 * Rules (first match wins):
 *  1. Trimmed empty string  → "empty"
 *  2. Contains a newline AND matches a MOL/SDF version stamp
 *     (`V2000` / `V3000` / `M  END`)  → "structure"
 *  3. Starts with `InChI=`           → "structure"
 *  4. `isValidSmiles(trimmed)` true  → "structure"
 *  5. Otherwise                      → "name"
 */
export function classifyPaste(
  text: string,
  isValidSmiles: (s: string) => boolean,
): PasteKind {
  const trimmed = text.trim();

  if (!trimmed) return "empty";

  // MOL / SDF block: must have at least one newline and contain a version line
  if (trimmed.includes("\n")) {
    if (/V[23]000/.test(trimmed) || /^M {2}END/m.test(trimmed)) {
      return "structure";
    }
  }

  // Standard InChI string
  if (trimmed.startsWith("InChI=")) return "structure";

  // Let the caller decide via RDKit (or any SMILES validator)
  if (isValidSmiles(trimmed)) return "structure";

  return "name";
}
