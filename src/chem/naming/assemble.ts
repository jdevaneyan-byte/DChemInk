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

/**
 * Whether prefix locants should be omitted for a given group.
 *
 * Locants are omitted when they add no information:
 * - chainLen = 1 (methane parent): all substituents are at position 1 (forced).
 * - chainLen = 2, all locants are 1, and there is only ONE distinct prefix name
 *   (a single terminal substituent on ethane is unambiguous — both ends are
 *   equivalent when the chain is otherwise unsubstituted at this position).
 *
 * This gives: "chloroethane" (not "1-chloroethane"), "methoxyethane" (not
 * "1-methoxyethane"), "trifluoromethane" (not "1,1,1-trifluoromethane").
 */
function omitPrefixLocants(locants: number[], chainLen: number, allUniqueSubs: number): boolean {
  if (chainLen === 1) return true; // methane: always at position 1
  // Ethane: omit only for a SINGLE substituent occurrence (both ends equivalent,
  // so its locant is degenerate). With two or more substituents the positions
  // matter — "1,1-dichloroethane" vs "1,2-dichloroethane" — so keep the locants.
  if (chainLen === 2 && locants.length === 1 && locants[0] === 1 && allUniqueSubs === 1) return true;
  return false;
}

function prefixSegment(subs: { locant: number; name: string }[], chainLen?: number): string {
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
  const numUniqueSubs = parts.length;
  return parts
    .map((p) => {
      const omit = chainLen !== undefined && omitPrefixLocants(p.locants, chainLen, numUniqueSubs);
      if (omit) {
        return `${multiplierPrefix(p.locants.length)}${displayName(p.name)}`;
      }
      return `${p.locants.join(",")}-${multiplierPrefix(p.locants.length)}${displayName(p.name)}`;
    })
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
 * - Any suffix on a 2-carbon chain where the position is forced (ethanamine, ethanol).
 * - Any suffix on a 1-carbon chain (methanol → methanol, no locant possible).
 */
function omitSuffixLocants(kind: SuffixKind, locants: number[], chainLen: number): boolean {
  if (locants.length > 1) {
    // Multiple occurrences: omit for terminal-only groups whose positions are
    // forced to the chain ends — dial, dioic acid, dinitrile, diamide. (The
    // nitrile/amide/aldehyde/acid carbon is inherently a chain terminus.)
    return kind === "al" || kind === "oic acid" || kind === "nitrile" || kind === "amide";
  }
  // Single occurrence:
  // Terminal-only suffixes always at position 1 (or last): no locant needed
  if (kind === "al" || kind === "oic acid" || kind === "nitrile" || kind === "amide") return true;
  // On a 2-carbon chain the suffix can only be at locant 1 (PCG-lowest rule forces it
  // to the lower end), so the locant is degenerate and omitted.
  // e.g. ethanol (not ethan-1-ol), ethanamine (not ethan-1-amine).
  // Similarly for a 1-carbon parent (methanol, methanamine).
  if (chainLen <= 2 && locants[0] === 1) return true;
  // ol/one/amine on longer chains: cite the locant
  return false;
}

/** Build the full suffix string including locants and multiplicity, e.g. "-2-one", "-1,4-diol". */
function suffixString(spec: SuffixSpec, chainLen: number): string {
  const { kind, locants } = spec;
  const multi = locants.length;
  let multPrefix = multiplierPrefix(multi); // "" / "di" / "tri" / "tetra" / ...
  // Elide the trailing 'a' of a multiplying prefix (tetra, penta, …) before a
  // suffix beginning with 'a' or 'o': "tetra"+"ol" → "tetrol". di/tri don't end
  // in 'a', so they're unaffected (butane-1,4-diol keeps "di").
  if (multPrefix.endsWith("a") && (kind[0] === "a" || kind[0] === "o")) {
    multPrefix = multPrefix.slice(0, -1);
  }

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
  return `${prefixSegment(input.subs, input.chainLen)}${name}`;
}

// ── Two-part name builders for acid derivatives (Tier 2b) ───────────────────

export type Sub = { locant: number; name: string };

/**
 * Build the acyl group name for a chain of `chainLen` carbons with the given
 * unsaturation and substituents. The carbonyl carbon is C1 of the chain.
 *
 * Naming: acid parent → replace "-oic acid" with "-oyl" (e-elision before 'o').
 * Examples: ethanoyl (2C), propanoyl (3C), prop-2-enoyl (3C, double at 2).
 */
export function acylName(chainLen: number, doubles: number[], triples: number[], subs: Sub[]): string {
  const stem = parentStem(chainLen);
  // Build the parent name as if it were the hydrocarbon (ane/ene/yne).
  const parentName = ending(stem, chainLen, doubles, triples);
  // Convert to acyl: drop trailing 'e' (if present) and append 'oyl'.
  // All endings (ane/ene/yne) end in 'e', so e-elision always applies.
  let base = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
  let acyl = base + "oyl";
  if (subs.length === 0) return acyl;
  return `${prefixSegment(subs, chainLen)}${acyl}`;
}

const HALIDE_WORD: Record<string, string> = {
  F: "fluoride",
  Cl: "chloride",
  Br: "bromide",
  I: "iodide",
};

/**
 * Compose an acyl halide name: "<acyl> <halide-word>".
 * e.g. acylHalideName("ethanoyl", "Cl") → "ethanoyl chloride"
 */
export function acylHalideName(acyl: string, halogen: string): string {
  const word = HALIDE_WORD[halogen] ?? halogen.toLowerCase() + "ide";
  return `${acyl} ${word}`;
}

/**
 * Build an ester name: "<alkyl> <acid-stem>oate".
 * The acid stem is derived from the acyl chain (same logic as acylName, but ending
 * in "oate" rather than "oyl"). e-elision applies before 'o'.
 * e.g. esterName("ethyl", 2, [], [], []) → "ethyl ethanoate"
 * e.g. esterName("methyl", 3, [2], [], []) → "methyl prop-2-enoate"
 */
export function esterName(alkyl: string, acidChainLen: number, doubles: number[], triples: number[], subs: Sub[]): string {
  const stem = parentStem(acidChainLen);
  const parentName = ending(stem, acidChainLen, doubles, triples);
  // e-elision before '-oate' (starts with 'o')
  let base = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
  let acidStem = base + "oate";
  if (subs.length > 0) {
    acidStem = `${prefixSegment(subs, acidChainLen)}${acidStem}`;
  }
  return `${alkyl} ${acidStem}`;
}

/**
 * Build an anhydride name.
 * Symmetric (side1 === side2): "<stem>oic anhydride"
 * Mixed: both stems alphabetically sorted, each kept as-is (must already end in "oic"),
 *   then space "anhydride".
 * e.g. anhydrideName("ethanoic", "ethanoic") → "ethanoic anhydride"
 * e.g. anhydrideName("ethanoic", "propanoic") → "ethanoic propanoic anhydride"
 */
export function anhydrideName(side1: string, side2: string): string {
  if (side1 === side2) {
    return `${side1} anhydride`;
  }
  // Alphabetical order
  const [a, b] = side1 < side2 ? [side1, side2] : [side2, side1];
  return `${a} ${b} anhydride`;
}
