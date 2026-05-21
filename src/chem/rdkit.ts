import initRDKitModule from "@rdkit/rdkit";
import type { RDKitLoader, RDKitModule, JSMol } from "@rdkit/rdkit";

// The package ships a CJS default export, but its type declaration only names
// the loader. Cast through unknown to bridge the gap.
const initRDKit_: RDKitLoader = initRDKitModule as unknown as RDKitLoader;

// The shipped RDKitLoaderOptions type declares `locateFile?: () => string`,
// but the actual emscripten contract passes the asset name as an argument.
// JSMol's .d.ts is also missing `get_num_atoms()` even though MinimalLib
// exposes it. We narrow this locally rather than modify node_modules.
type JSMolWithAtomCount = JSMol & { get_num_atoms(): number };

let rdkit: RDKitModule | null = null;

export interface InitOptions {
  /**
   * Resolve the path/URL of the named asset (e.g. `"RDKit_minimal.wasm"`).
   * Defaults to serving from the site root, suitable when the WASM is in
   * `public/`. Tests can supply a filesystem path resolver.
   */
  locateFile?: (file: string) => string;
}

/**
 * Lazily initialize the RDKit-JS WASM module. Subsequent calls are a no-op
 * and return the same instance.
 */
export async function initRDKit(options: InitOptions = {}): Promise<RDKitModule> {
  if (rdkit) return rdkit;
  const locateFile = options.locateFile ?? ((file: string) => `/${file}`);
  rdkit = await initRDKit_({ locateFile: locateFile as unknown as () => string });
  return rdkit;
}

/**
 * Parse a SMILES string into an RDKit molecule.
 *
 * @returns The parsed `JSMol` on success, or `null` for empty / invalid SMILES.
 *   **The caller MUST call `mol.delete()` when finished** to release the WASM
 *   heap. Forgetting to delete leaks memory inside the RDKit module.
 *
 * @throws If `initRDKit()` has not been called first.
 */
export function parseSmiles(smiles: string): JSMol | null {
  if (!rdkit) {
    throw new Error("RDKit not initialized — call initRDKit() first");
  }
  const mol = rdkit.get_mol(smiles) as JSMolWithAtomCount | null;
  if (!mol || !mol.is_valid() || mol.get_num_atoms() === 0) {
    mol?.delete();
    return null;
  }
  return mol;
}
