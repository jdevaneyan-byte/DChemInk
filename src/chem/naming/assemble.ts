// src/chem/naming/assemble.ts
import { parentStem, multiplierPrefix } from "./graph";

export interface AssemblyInput {
  chainLen: number;
  doubles: number[];   // ene locants (ascending)
  triples: number[];   // yne locants (ascending)
  subs: { locant: number; name: string }[];
}

/**
 * Alphabetization key. IUPAC alphabetizes a complex substituent by the FIRST
 * LETTER of its complete name (e.g. "2-methylpropyl" sorts under 'm', not '2').
 * Strip any wrapping parens, then drop leading locants/commas/parens/hyphens
 * down to the first alphabetic character.
 */
function alphaKey(name: string): string {
  return name.replace(/^\((.*)\)$/, "$1").replace(/^[\d,()\-\s]+/, "");
}

/**
 * A substituent is "complex" when its name carries an internal locant (any
 * digit), e.g. "2-methylpropyl" or "propan-2-yl". Such names are wrapped in
 * parentheses; simple names (methyl, ethyl, propyl) are not.
 */
function isComplex(name: string): boolean {
  return /\d/.test(name);
}

function displayName(name: string): string {
  return isComplex(name) ? `(${name})` : name;
}

function prefixSegment(subs: { locant: number; name: string }[]): string {
  const groups = new Map<string, number[]>();
  for (const s of subs) {
    const arr = groups.get(s.name) ?? [];
    arr.push(s.locant);
    groups.set(s.name, arr);
  }
  const parts = [...groups.entries()].map(([name, locants]) => ({
    name, locants: locants.sort((a, b) => a - b),
  }));
  parts.sort((a, b) => {
    const ka = alphaKey(a.name), kb = alphaKey(b.name);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return parts
    .map((p) => `${p.locants.join(",")}-${multiplierPrefix(p.locants.length)}${displayName(p.name)}`)
    .join("-");
}

/** Build the unsaturation ending, e.g. "ane", "-2-ene", "a-1,3-diene", "-1-en-4-yne". */
function ending(stem: string, doubles: number[], triples: number[]): string {
  if (doubles.length === 0 && triples.length === 0) return `${stem}ane`;

  const segs: string[] = [];
  // The 'a' euphonic linker appears before multiplied suffixes (diene, triene, diyne).
  // A single ene or a single ene + single yne does NOT take the 'a' linker.
  // e.g. "buta-1,3-diene" (needA=true), "pent-1-en-4-yne" (needA=false).
  const needA = doubles.length > 1 || triples.length > 1;
  const head = needA ? `${stem}a` : stem;

  if (doubles.length) {
    const mult = multiplierPrefix(doubles.length);
    // "en" when followed by a yne suffix, else "ene".
    const tail = triples.length ? "en" : "ene";
    segs.push(`-${doubles.join(",")}-${mult}${tail}`);
  }
  if (triples.length) {
    const mult = multiplierPrefix(triples.length);
    segs.push(`-${triples.join(",")}-${mult}yne`);
  }
  return head + segs.join("");
}

export function assembleName(input: AssemblyInput): string {
  const stem = parentStem(input.chainLen);
  const parentName = ending(stem, input.doubles, input.triples);
  if (input.subs.length === 0) return parentName;
  // Prefix block appended directly to parent name (no separator before parent).
  // e.g. "2-methyl" + "butane" = "2-methylbutane"
  // e.g. "4-ethyl-2,2-dimethyl" + "hexane" = "4-ethyl-2,2-dimethylhexane"
  return `${prefixSegment(input.subs)}${parentName}`;
}
