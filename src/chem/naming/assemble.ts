// src/chem/naming/assemble.ts
import { parentStem, multiplierPrefix } from "./graph";

export type SuffixKind = "ol" | "al" | "one" | "amine" | "amide" | "nitrile" | "oic acid";

export interface SuffixSpec {
  kind: SuffixKind;
  locants: number[]; // ascending
}

export interface AssemblyInput {
  chainLen: number;
  doubles: number[];   // ene locants (ascending)
  triples: number[];   // yne locants (ascending)
  subs: { locant: number; name: string }[];
  suffix?: SuffixSpec; // principal characteristic group
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
function ending(stem: string, chainLen: number, doubles: number[], triples: number[]): string {
  if (doubles.length === 0 && triples.length === 0) return `${stem}ane`;

  // On a 2-carbon chain the single double/triple bond can only be at locant 1,
  // which is degenerate and omitted: "ethene"/"ethyne" (not "eth-1-ene"). Longer
  // chains keep the locant even when unique (e.g. PubChem's "prop-1-ene").
  if (chainLen === 2) {
    return doubles.length ? `${stem}ene` : `${stem}yne`;
  }

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

/**
 * Suffix-initial character for e-elision purposes.
 *
 * Vowel-initial suffixes trigger e-elision (drop the trailing 'e' of the parent):
 *   ol, al, one, amine, amide, oic acid
 * Consonant-initial suffixes keep the 'e':
 *   nitrile
 * Multiplicity prefixes (di/tri) always start with 'd'/'t' (consonant) — keep 'e'.
 */
function suffixStartsWithVowel(kind: SuffixKind, multi: number): boolean {
  // With multiplicity (di/tri…) the suffix string gets a 'd' or 't' prepended → consonant.
  if (multi > 1) return false;
  return kind === "ol" || kind === "al" || kind === "one" || kind === "amine" ||
    kind === "amide" || kind === "oic acid";
}

/**
 * Whether the locants must be cited in the suffix.
 *
 * Omit locants for:
 * - Terminal groups that can ONLY appear at position 1 (acid, al, nitrile, amide
 *   when the group is at a chain end and there's only one occurrence).
 * - Any suffix on a 2-carbon chain where the position is forced (ethanamine).
 */
function omitSuffixLocants(kind: SuffixKind, locants: number[], chainLen: number): boolean {
  if (locants.length > 1) {
    // Multiple occurrences: omit for terminal-only groups (al, oic acid)
    return kind === "al" || kind === "oic acid";
  }
  // Single occurrence:
  // Terminal-only suffixes always at position 1 (or last): no locant needed
  if (kind === "al" || kind === "oic acid" || kind === "nitrile" || kind === "amide") return true;
  // amine on a 2-carbon chain: ethanamine (degenerate, only at 1)
  if (kind === "amine" && chainLen === 2) return true;
  // ol/one/amine on longer chains: cite the locant
  return false;
}

/** Build the full suffix string including locants and multiplicity, e.g. "-2-one", "-1,4-diol". */
function suffixString(spec: SuffixSpec, chainLen: number): string {
  const { kind, locants } = spec;
  const multi = locants.length;
  const multPrefix = multiplierPrefix(multi); // "" / "di" / "tri"

  const omit = omitSuffixLocants(kind, locants, chainLen);
  const locantStr = omit ? "" : locants.join(",") + "-";

  // Build the suffix text: multiplicity prefix + kind
  const suffixText = `${multPrefix}${kind}`;

  if (omit) {
    // No locant: suffix attaches immediately after the parent stem
    return suffixText;
  }
  // Cite locant: prefix with "-locant-"
  return `-${locantStr}${suffixText}`;
}

/** Attach the suffix to the parent name (which ends in -ane/-ene/-yne). */
function attachSuffix(parentName: string, spec: SuffixSpec, chainLen: number): string {
  const multi = spec.locants.length;
  const dropE = suffixStartsWithVowel(spec.kind, multi);

  // The parentName ends in 'e' for ane/ene (e.g. "propane", "propene").
  // For yne it ends in 'e' too (e.g. "propyne").
  let base = parentName;
  if (dropE && base.endsWith("e")) {
    base = base.slice(0, -1); // drop trailing 'e' before vowel-initial suffix
  }

  const suf = suffixString(spec, chainLen);
  return base + suf;
}

export function assembleName(input: AssemblyInput): string {
  const stem = parentStem(input.chainLen);
  const parentName = ending(stem, input.chainLen, input.doubles, input.triples);

  let name: string;
  if (input.suffix) {
    name = attachSuffix(parentName, input.suffix, input.chainLen);
  } else {
    name = parentName;
  }

  if (input.subs.length === 0) return name;
  // Prefix block appended directly to parent name (no separator before parent).
  // e.g. "2-methyl" + "butane" = "2-methylbutane"
  // e.g. "4-ethyl-2,2-dimethyl" + "hexane" = "4-ethyl-2,2-dimethylhexane"
  return `${prefixSegment(input.subs)}${name}`;
}
