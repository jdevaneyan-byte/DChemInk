/**
 * Name → structure resolution via PubChem PUG REST API.
 * All network I/O is injectable so unit tests can mock without real network.
 */

const PUBCHEM_BASE =
  "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name";

/**
 * Returns the PubChem PUG REST URL for resolving a name to its canonical SMILES.
 * Pure function — trims and URL-encodes the name.
 */
export function buildPubchemNameUrl(name: string): string {
  const encoded = encodeURIComponent(name.trim());
  return `${PUBCHEM_BASE}/${encoded}/property/SMILES/TXT`;
}

/**
 * Parses the plain-text body returned by PubChem.
 * Returns the first non-empty trimmed line, or null if the body:
 *   - is empty / whitespace-only
 *   - looks like a PUGREST error (starts with "Status:" or contains "PUGREST.")
 */
export function parseSmilesResponse(body: string): string | null {
  if (!body || !body.trim()) return null;
  if (body.trimStart().startsWith("Status:")) return null;
  if (body.includes("PUGREST.")) return null;

  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  return firstLine ?? null;
}

/**
 * Resolves a chemical name to a SMILES string via PubChem.
 *
 * @param name      - Chemical name entered by the user (will be trimmed).
 * @param fetchImpl - Injectable fetch implementation (defaults to global fetch).
 * @returns `{ smiles }` on success, `{ error }` on any failure.
 */
export async function resolveNameToSmiles(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ smiles: string } | { error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name" };

  const url = buildPubchemNameUrl(trimmed);

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    return { error: "Network error — check your connection" };
  }

  if (!response.ok) {
    if (response.status === 404) {
      return { error: `No match found for "${trimmed}"` };
    }
    return { error: `Lookup failed (HTTP ${response.status})` };
  }

  const body = await response.text();
  const smiles = parseSmilesResponse(body);
  if (!smiles) return { error: "No structure returned" };

  return { smiles };
}
