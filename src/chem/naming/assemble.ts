// src/chem/naming/assemble.ts
import { parentStem, multiplierPrefix } from "./graph";

export type SuffixKind = "ol" | "al" | "one" | "amine" | "amide" | "nitrile" | "oic acid";

/**
 * Build the front stereodescriptor for a name, e.g. "(E)-", "(2R)-", "(2E,4Z)-",
 * "(2R,3S)-". Returns "" when no in-scope stereo elements exist.
 *
 * `locantOf(atomIndex)` returns the parent locant of an atom, or undefined when
 * the atom is not part of the parent numbering (that stereo element is skipped).
 *
 * Citation rule (PubChem-verified): a lone E/Z double bond omits its locant
 * ("(E)-but-2-ene"); a lone R/S center cites it ("(2R)-butan-2-ol"); and any
 * combination of ≥2 stereo elements cites every locant, sorted ascending
 * ("(2E,4Z)-hexa-2,4-diene", "(2R,3S)-butane-2,3-diol").
 *
 * Returns:
 *  - ""    when the molecule has no specified stereo,
 *  - null  when there IS specified stereo but some element cannot be placed in
 *          the parent numbering (e.g. a stereocenter on a branch). The caller
 *          must DECLINE rather than emit a name that silently drops stereo
 *          (which would denote a less-specific structure — no wrong names),
 *  - the "(...)-" prefix when every specified element was placed.
 */
export function stereoDescriptor(
  graph: {
    stereoAtoms?: Map<number, "R" | "S">;
    stereoBonds?: { a: number; b: number; label: "E" | "Z" }[];
    specifiedStereoCount?: number;
    hasUndefinedStereo?: boolean;
  },
  locantOf: (atomIndex: number) => number | undefined,
  // Number of ene+yne unsaturations in the parent. A lone E/Z descriptor may omit
  // its locant ONLY when this is exactly 1 (e.g. "(E)-but-2-ene"); with several
  // double bonds the locant is required to say which one is E/Z ("(5Z)-…diene").
  parentUnsaturationCount = 1,
): string | null {
  // Authoritative total = ALL specified stereo (incl. pseudoasymmetric / cis-trans
  // that carry no uppercase CIP label). If we can't place every one, decline.
  const total = graph.specifiedStereoCount ??
    ((graph.stereoAtoms?.size ?? 0) + (graph.stereoBonds?.length ?? 0));
  if (total === 0) return "";
  // A specified center next to an unassignable "(?)" center → defined R/S labels
  // are unreliable (CIP depends on the undefined neighbour) → decline.
  if (graph.hasUndefinedStereo) return null;

  const items: { locant: number; label: string; isBond: boolean }[] = [];
  if (graph.stereoAtoms) {
    for (const [idx, label] of graph.stereoAtoms) {
      const loc = locantOf(idx);
      if (loc !== undefined) items.push({ locant: loc, label, isBond: false });
    }
  }
  if (graph.stereoBonds) {
    for (const { a, b, label } of graph.stereoBonds) {
      const la = locantOf(a);
      const lb = locantOf(b);
      if (la !== undefined && lb !== undefined) {
        items.push({ locant: Math.min(la, lb), label, isBond: true });
      }
    }
  }
  // Some specified stereo could not be located in the parent numbering → decline.
  if (items.length < total) return null;

  items.sort((x, y) => x.locant - y.locant || (x.label < y.label ? -1 : 1));

  if (items.length === 1 && items[0].isBond && parentUnsaturationCount <= 1) return `(${items[0].label})-`;
  return `(${items.map((it) => `${it.locant}${it.label}`).join(",")})-`;
}

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
function omitPrefixLocants(
  locants: number[],
  chainLen: number,
  allUniqueSubs: number,
  hasSuffix = false,
): boolean {
  if (chainLen === 1) return true; // methane: always at position 1
  // Ethane: omit only for a SINGLE substituent occurrence (both ends equivalent,
  // so its locant is degenerate). With two or more substituents the positions
  // matter — "1,1-dichloroethane" vs "1,2-dichloroethane" — so keep the locants.
  // Exception: when a non-terminal suffix (ketone/ol/amine) is also present at
  // locant 1, the substituent locant IS needed to unambiguously place it on the
  // same carbon as the suffix. e.g. "1-phenylethanone" not "phenylethanone".
  if (hasSuffix) return false; // always cite when a positioned suffix is present
  if (chainLen === 2 && locants.length === 1 && locants[0] === 1 && allUniqueSubs === 1) return true;
  return false;
}

function prefixSegment(
  subs: { locant: number; name: string }[],
  chainLen?: number,
  hasSuffix = false,
): string {
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
      const omit = chainLen !== undefined && omitPrefixLocants(p.locants, chainLen, numUniqueSubs, hasSuffix);
      if (omit) {
        return `${multiplierPrefix(p.locants.length)}${displayName(p.name)}`;
      }
      return `${p.locants.join(",")}-${multiplierPrefix(p.locants.length)}${displayName(p.name)}`;
    })
    .join("-");
}

/**
 * Build an alkyl / alkenyl / alkynyl SUBSTITUENT name (the "-yl" form).
 *   saturated:  valence 1 → "propyl";  interior valence → "propan-2-yl"
 *   alkenyl:    "ethenyl", "prop-1-en-1-yl", "prop-1-en-2-yl", "prop-2-en-1-yl",
 *               "buta-1,3-dien-1-yl"
 *   alkynyl:    "ethynyl", "prop-2-yn-1-yl"
 * `valence` is the locant of the free valence (already chosen lowest); doubles/
 * triples are ene/yne locants on the substituent chain.
 */
export function alkenylYl(chainLen: number, valence: number, doubles: number[], triples: number[]): string {
  const stem = parentStem(chainLen);
  if (doubles.length === 0 && triples.length === 0) {
    return valence === 1 ? `${stem}yl` : `${stem}an-${valence}-yl`;
  }
  // 2-carbon: the single bond is degenerate at locant 1 → "ethenyl" / "ethynyl".
  if (chainLen === 2) return `${stem}${doubles.length ? "en" : "yn"}yl`;

  const needA = doubles.length > 1 || (doubles.length === 0 && triples.length > 1);
  const head = needA ? `${stem}a` : stem;
  let mid = "";
  if (doubles.length) mid += `-${doubles.join(",")}-${multiplierPrefix(doubles.length)}en`;
  if (triples.length) mid += `-${triples.join(",")}-${multiplierPrefix(triples.length)}yn`;
  return `${head}${mid}-${valence}-yl`;
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
  // The 'a' euphonic linker appears when the FIRST descriptor cited is multiplied
  // (diene, triene, …) or when only triples are present and they are multiplied
  // (diyne, triyne, …). A single ene — even when followed by a multiplied yne —
  // does NOT take the 'a', because the ene descriptor itself is not multiplied.
  // e.g. "buta-1,3-diene" (diene → needA=true)
  //      "hept-1-en-3,5-diyne" (single ene first → needA=false)
  //      "hepta-1,3-diyne" (only triples, multiplied → needA=true)
  //      "pent-1-en-4-yne" (single ene + single yne → needA=false)
  const needA = doubles.length > 1 || (doubles.length === 0 && triples.length > 1);
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
  // When a non-terminal suffix (one/ol/amine) is present, pass hasSuffix=true to
  // ensure substituent locants are cited even on 2-carbon chains (e.g. 1-phenylethanone).
  const hasSuffix = !!input.suffix && (
    input.suffix.kind === "one" || input.suffix.kind === "ol" || input.suffix.kind === "amine"
  );
  return `${prefixSegment(input.subs, input.chainLen, hasSuffix)}${name}`;
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
  const base = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
  const acyl = base + "oyl";
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
  const base = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
  const acidStemBase = base + "oate";
  const acidStem = subs.length > 0 ? `${prefixSegment(subs, acidChainLen)}${acidStemBase}` : acidStemBase;
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

// ── Ring-parent assembly (Tier 3) ────────────────────────────────────────────

export type AddedCarbonSuffix = "carboxylic acid" | "carbonitrile" | "carbaldehyde" | "carboxamide";

export interface RingAssemblyInput {
  parent: string;           // "cyclohexane" | "benzene" | "pyridine" | etc.
  subs: { locant: number; name: string }[];
  ringDoubleBondLocants?: number[];  // cycloalkene/diene locants (ascending)
  suffix?: SuffixSpec;               // -ol/-one/-amine on a ring atom
  addedCarbon?: { kind: AddedCarbonSuffix; locants: number[] }; // exocyclic group
  retainedAromatic?: string;         // phenol/aniline/toluene/etc. — overrides parent
}

/**
 * Retained benzene names that permit further substitution.
 * These keep the retained parent even when there are additional substituents.
 */
const RETAINED_ALLOWS_SUBS = new Set(["phenol", "aniline", "benzoic acid", "benzaldehyde", "benzonitrile", "benzamide"]);

/**
 * Benzene + added-carbon suffix → retained name.
 * benzene + carboxylic acid → benzoic acid
 * benzene + carbaldehyde    → benzaldehyde
 * benzene + carbonitrile    → benzonitrile
 */
const BENZENE_ADDED_CARBON_RETAINED: Partial<Record<AddedCarbonSuffix, string>> = {
  "carboxylic acid": "benzoic acid",
  "carbaldehyde": "benzaldehyde",
  "carbonitrile": "benzonitrile",
  "carboxamide": "benzamide",
};

/**
 * Assemble a ring parent name with substituents, unsaturation, suffix, and
 * added-carbon groups.
 *
 * Rules:
 * - Single substituent on any ring → no locant prefix (methylcyclohexane)
 * - Two or more substituents → locants (1,2-dimethylcyclohexane)
 * - Cyclohexene: locant 1 omitted when there is exactly one double bond and the ring is
 *   "cyclohexane" style (parent ends in "ane") → "cyclohexene"
 * - Cyclohexa-1,3-diene: two double bonds
 * - -ol/-one/-amine suffix with e-elision (cyclohexanol, cyclohexanone)
 * - Added-carbon: "cyclohexanecarboxylic acid", "benzene→benzoic acid" (retained)
 * - retainedAromatic: direct override (phenol, aniline, etc.)
 */
export function assembleRingName(input: RingAssemblyInput): string {
  const { parent, subs, ringDoubleBondLocants, suffix, addedCarbon, retainedAromatic } = input;

  // Whether locants are always required for substituents (heterocycles + retained aromatics)
  const isHeteroCycleParent = !parent.startsWith("cyclo") && parent !== "benzene";

  // ── Retained name override ──────────────────────────────────────────────────
  if (retainedAromatic) {
    // The retained name is the base; add substituent prefixes if any
    if (subs.length === 0) return retainedAromatic;
    // For retained names that allow further substitution (phenol, aniline, etc.),
    // prepend substituent locants — always cite locants for retained aromatics
    if (RETAINED_ALLOWS_SUBS.has(retainedAromatic)) {
      const pfx = prefixSegmentRing(subs, true); // always cite locants
      return `${pfx}${retainedAromatic}`;
    }
    // Retained names that don't allow substitution (toluene, styrene) → systematic fallback
    // should be handled by engine before calling assembleRingName; here just return
    return retainedAromatic;
  }

  // ── Benzene + added-carbon → retained ────────────────────────────────────────
  if (parent === "benzene" && addedCarbon) {
    const retained = BENZENE_ADDED_CARBON_RETAINED[addedCarbon.kind];
    if (retained) {
      if (subs.length === 0) return retained;
      // e.g. 4-chlorobenzoic acid (substituted benzoic acid)
      // Always cite locants for retained names with added subs
      const pfx = prefixSegmentRing(subs, true);
      return `${pfx}${retained}`;
    }
  }

  // ── Build the base parent name ────────────────────────────────────────────────
  // For carbocycles: handle unsaturation (cycloalkene/diene)
  // For benzene/heterocycles: no unsaturation modifications
  let baseName = parent;

  if (ringDoubleBondLocants && ringDoubleBondLocants.length > 0) {
    // Modify the carbocycle parent: cyclohexane → cyclohex-1-ene / cyclohexa-1,3-diene
    // parent ends in "ane" (cyclohexane, cyclopentane, etc.)
    if (parent.endsWith("ane")) {
      const stem = parent.slice(0, -3); // drop "ane"
      if (ringDoubleBondLocants.length === 1) {
        const loc = ringDoubleBondLocants[0];
        // For cyclohexene: locant 1 is omitted (it's the default starting point)
        // Actually, IUPAC 2013 requires the locant: cyclohex-1-ene is correct but
        // PubChem uses "cyclohexene" for cyclohex-1-ene. We use "cyclohexene".
        // For locant > 1, cite the locant: cyclohex-2-ene
        if (loc === 1) {
          baseName = `${stem}ene`;
        } else {
          baseName = `${stem}-${loc}-ene`;
        }
      } else {
        // Multiple double bonds: cyclohexa-1,3-diene
        const needA = parent.endsWith("ane"); // always true here
        const stemA = needA ? `${stem}a` : stem;
        const mult = multiplierPrefix(ringDoubleBondLocants.length);
        baseName = `${stemA}-${ringDoubleBondLocants.join(",")}-${mult}ene`;
      }
    }
  }

  // ── Apply suffix (on ring atom: -ol, -one, -amine) ───────────────────────────
  // Heterocycles and carbocycles both use suffix-on-ring; locants are always cited
  // for rings (ring position 1 is the heteroatom, not the PCG for hetero rings).
  // IUPAC rule: also cite locant 1 when there are OTHER ring substituents present,
  // or when the ring has double bonds (cycloalkene: position relative to π system matters).
  const hasOtherSubs = subs.length > 0 || !!(ringDoubleBondLocants && ringDoubleBondLocants.length > 0);
  if (suffix) {
    baseName = attachRingSuffix(baseName, suffix, parent, hasOtherSubs);
  }

  // ── Apply added-carbon suffix ─────────────────────────────────────────────────
  if (addedCarbon) {
    const { kind, locants } = addedCarbon;
    // "cyclohexanecarboxylic acid" — no e-elision before "carbo..."
    // The locant of the exocyclic group is cited when > 1 or when the parent is a
    // heterocycle (since the numbering matters for position on the ring).
    // Also cited when there are other ring substituents (hasOtherSubs).
    const locantStr = shouldCiteAddedCarbonLocant(locants, baseName, parent, hasOtherSubs)
      ? `-${locants.join(",")}-`
      : "";
    // Reconstruct: if baseName was modified by suffix we already handled that;
    // added-carbon replaces the suffix on carboxylic acid etc.
    // The added-carbon appends to the ring base (not to a suffix-modified name).
    // Re-derive the ring base without suffix:
    const ringBase = buildUnsaturatedBase(parent, ringDoubleBondLocants);
    // Multiple added-carbon groups take a multiplicative prefix:
    // spiro[5.5]undecane-1,9-dicarbaldehyde, cyclohexane-1,4-dicarboxylic acid.
    const mult = multiplierPrefix(locants.length);
    if (locantStr) {
      baseName = `${ringBase}${locantStr}${mult}${kind}`;
    } else {
      baseName = `${ringBase}${mult}${kind}`;
    }
  }

  // ── Substituent prefix ────────────────────────────────────────────────────────
  if (subs.length === 0) return baseName;

  // Always cite locants for heterocycles (position matters relative to heteroatom),
  // or when there's also a suffix (PCG at position 1, substituents need position info),
  // or when there are multiple substituents.
  // Also cite when the ring has double bonds (cycloalkene): substituent position
  // relative to the double bond must be unambiguous — e.g. 1-methylcyclohexene.
  const hasSuffix = !!suffix || !!addedCarbon;
  const hasRingUnsaturation = !!(ringDoubleBondLocants && ringDoubleBondLocants.length > 0);
  const pfx = prefixSegmentRing(subs, isHeteroCycleParent || hasSuffix || hasRingUnsaturation);
  // Bug 1 fix: when baseName starts with a digit (e.g. "1H-indole", "7H-purine",
  // "2H-chromene"), IUPAC requires a hyphen between the prefix block and the parent.
  // e.g. "2-methyl" + "1H-indole" → "2-methyl-1H-indole" (not "2-methyl1H-indole").
  // A letter-initial parent (naphthalene, quinoline) needs no extra hyphen.
  const needsHyphen = pfx.length > 0 && /^\d/.test(baseName);
  return needsHyphen ? `${pfx}-${baseName}` : `${pfx}${baseName}`;
}

/**
 * Determine whether the added-carbon locant should be cited.
 * Locant is cited when:
 *  - The ring is a heterocycle (locant conveys position relative to heteroatom)
 *  - The ring is benzene and locant ≠ 1 (but benzoic acid is already handled by retained)
 *  - For carbocycles: locant 1 is omitted (only one possible position when no subs),
 *    but cite when there are multiple possible positions (only relevant for dicarboxylic
 *    rings, which we'd handle separately).
 *  - hasOtherSubs: cite when there are other ring substituents (IUPAC rule: disambiguate).
 */
function shouldCiteAddedCarbonLocant(
  locants: number[],
  _baseName: string,
  parent: string,
  hasOtherSubs = false,
): boolean {
  // Heterocycles always cite the locant
  if (!parent.startsWith("cyclo") && parent !== "benzene") return true;
  // Benzene: benzoic acid is already handled via retained; shouldn't reach here
  // When other substituents are present, cite the locant even for position 1
  if (hasOtherSubs && locants.length === 1 && locants[0] === 1) return true;
  // Carbocycles: single locant 1 → omit; otherwise cite
  if (locants.length === 1 && locants[0] === 1) return false;
  return locants.length > 1 || (locants.length === 1 && locants[0] !== 1);
}

/** Build the ring base (possibly modified for unsaturation) without adding suffix. */
function buildUnsaturatedBase(parent: string, doubles?: number[]): string {
  if (!doubles || doubles.length === 0) return parent;
  if (!parent.endsWith("ane")) return parent;
  const stem = parent.slice(0, -3);
  if (doubles.length === 1 && doubles[0] === 1) return `${stem}ene`;
  if (doubles.length === 1) return `${stem}-${doubles[0]}-ene`;
  const stemA = `${stem}a`;
  const mult = multiplierPrefix(doubles.length);
  return `${stemA}-${doubles.join(",")}-${mult}ene`;
}

/**
 * Attach a suffix (-ol, -one, -amine) to a ring parent name.
 * Rules:
 *  - e-elision before vowel-initial suffixes (ol, one, amine — but amine starts
 *    with vowel only in a sense; actually "amine" starts with 'a' = vowel)
 *  - Locants: for carbocycles, locant 1 is omitted for -ol and -one (unique);
 *    for heterocycles, always cite the locant.
 *  - cyclohexanone: the 'e' from 'ane' is dropped → "cyclohexan" + "one"
 *  - cyclohexanol: 'e' dropped → "cyclohexan" + "ol"
 *  - cyclohexan-1-amine: 'e' dropped → "cyclohexan" + "-1-amine" (with locant)
 *  - pyridin-3-ol: 'e' dropped, locant always cited for hetero
 *  - hasOtherSubs: cite locant 1 even for carbocycles when other subs are present
 *    (IUPAC rule: 4-methylcyclohexan-1-ol, not 4-methylcyclohexanol)
 */
function attachRingSuffix(baseName: string, spec: SuffixSpec, originalParent: string, hasOtherSubs = false): string {
  const { kind, locants } = spec;
  const isCarbocycle = originalParent.startsWith("cyclo");
  const isBenzene = originalParent === "benzene";
  const isHetero = !isCarbocycle && !isBenzene;

  // e-elision: drop trailing 'e' for vowel-initial suffixes.
  // When the multiplicity prefix (di, tri, …) is prepended, the effective first
  // character changes: di/tri start with a consonant, so NO e-elision for multi>1.
  // e.g. benzene + -1,4-diol: "di" + "ol" → "diol" starts with 'd' (consonant)
  //      → keep 'e': "benzene-1,4-diol" (not "benzen-1,4-diol").
  // e.g. cyclohexane + -one: "one" starts with 'o' (vowel) → elide 'e': "cyclohexanone".
  const vowelSuffixes = new Set(["ol", "one", "amine", "al", "amide"]);
  const multi = locants.length;
  // e-elision applies only when the suffix DIRECTLY starts with a vowel,
  // which is only the case for a SINGLE occurrence (no di/tri multiplier).
  const dropE = vowelSuffixes.has(kind) && multi === 1;
  let base = baseName;
  if (dropE && base.endsWith("e")) {
    base = base.slice(0, -1);
  }

  // Locant citation:
  // For carbocycles (and benzene treated as carbocycle):
  //   - -ol: omit locant 1 → "cyclohexanol" (but cite when other subs present)
  //   - -one: omit locant 1 → "cyclohexanone" (but cite when other subs present)
  //   - -amine: omit locant 1 → "cyclohexanamine" (IUPAC preferred; PubChem confirms)
  // For heterocycles: always cite locant (position relative to heteroatom matters)
  // hasOtherSubs: force locant citation when other ring substituents are present
  const alwaysOmitLoc1 = !isHetero && !hasOtherSubs && (kind === "ol" || kind === "one" || kind === "amine");
  const alwaysCite = isHetero;

  const multPfx = multiplierPrefix(multi);

  if (multi === 1) {
    const loc = locants[0];
    if (alwaysOmitLoc1 && loc === 1) {
      return `${base}${multPfx}${kind}`;
    }
    if (!alwaysCite && !isHetero && !hasOtherSubs && loc === 1 && kind !== "amine") {
      return `${base}${multPfx}${kind}`;
    }
    // Cite the locant
    return `${base}-${loc}-${multPfx}${kind}`;
  }

  // Multiple locants (e.g. diol, dione)
  const locStr = locants.join(",");
  return `${base}-${locStr}-${multPfx}${kind}`;
}

/**
 * Build the prefix segment for ring substituents.
 * Single substituent on carbocycle/benzene → no locant.
 * Multiple substituents, or any substituent on a heterocycle → with locants.
 *
 * @param alwaysLocants - force locant citation (heterocycles, retained aromatics)
 */
function prefixSegmentRing(
  subs: { locant: number; name: string }[],
  alwaysLocants = false,
): string {
  if (subs.length === 0) return "";

  // Group by name
  const groups = new Map<string, number[]>();
  for (const s of subs) {
    const arr = groups.get(s.name) ?? [];
    arr.push(s.locant);
    groups.set(s.name, arr);
  }

  const parts = [...groups.entries()].map(([name, locants]) => ({
    name,
    locants: locants.sort((a, b) => a - b),
  }));

  // Sort alphabetically
  parts.sort((a, b) => {
    const ka = alphaKeyRing(a.name);
    const kb = alphaKeyRing(b.name);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Total substituent count: if >1, always cite locants
  const totalSubs = subs.length;
  const omitLocants = !alwaysLocants && totalSubs === 1;

  return parts
    .map((p) => {
      const disp = isComplexName(p.name) ? `(${p.name})` : p.name;
      const mult = multiplierPrefix(p.locants.length);
      if (omitLocants) {
        return `${mult}${disp}`;
      }
      return `${p.locants.join(",")}-${mult}${disp}`;
    })
    .join("-");
}

function alphaKeyRing(name: string): string {
  return name.replace(/^\((.*)\)$/, "$1").replace(/^[\d,()\-\s]+/, "");
}

function isComplexName(name: string): boolean {
  return /\d/.test(name);
}
