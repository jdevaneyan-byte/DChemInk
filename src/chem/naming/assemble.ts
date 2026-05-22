// src/chem/naming/assemble.ts
import { parentStem, multiplierPrefix } from "./graph";

export interface AssemblyInput {
  chainLen: number;
  doubles: number[];   // ene locants (ascending)
  triples: number[];   // yne locants (ascending)
  subs: { locant: number; name: string }[];
}

/** Strip a leading multiplier so alphabetization sorts on the substituent base. */
function alphaKey(name: string): string {
  // Complex (parenthesized) names alphabetize by their full first letter; simple
  // names by the base. Leading di/tri/tetra in *complex* names is rare in T1.
  return name.replace(/^\((.*)\)$/, "$1");
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
    .map((p) => `${p.locants.join(",")}-${multiplierPrefix(p.locants.length)}${p.name}`)
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
