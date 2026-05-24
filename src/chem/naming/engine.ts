// src/chem/naming/engine.ts
import type { MolGraph, NameResult } from "./graph";
import { buildCarbonGraph, ccOrder, selectPrincipalChain, type CarbonGraph } from "./chain";
import { nameSubstituent } from "./substituent";
import { assembleName, acylName, acylHalideName, esterName, anhydrideName, assembleRingName, type SuffixKind, type Sub } from "./assemble";
import { perceiveGroups, principalKind, SENIORITY, type Group, type GroupKind } from "./functionalGroups";
import { perceiveRing, nameRing, ringSubstituentName, perceiveRingSystem, nameFusedRing, type RingInfo } from "./ring";

/**
 * Elements supported by Tier 2+3 (C, H, O, N, F, Cl, Br, I, S for heterocycles).
 * Anything else → unsupported.
 */
const SUPPORTED_ELEMENTS = new Set(["C", "H", "O", "N", "F", "Cl", "Br", "I", "S"]);

/**
 * True if the heavy-atom (non-H) graph contains a cycle. For each connected
 * component, a cycle exists iff the number of intra-component bonds is at least
 * the number of atoms in that component (a tree has atoms-1 bonds).
 */
function hasHeavyAtomCycle(graph: MolGraph): boolean {
  const heavy = new Set(graph.atoms.filter((a) => a.element !== "H").map((a) => a.index));
  const heavyBonds = graph.bonds.filter((b) => heavy.has(b.from) && heavy.has(b.to));

  // Union-find over heavy atoms to size components and detect closing edges.
  const parent = new Map<number, number>();
  for (const i of heavy) parent.set(i, i);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
    return r;
  };
  const atomsIn = new Map<number, number>();
  const bondsIn = new Map<number, number>();
  for (const b of heavyBonds) {
    const ra = find(b.from), rb = find(b.to);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const i of heavy) {
    const r = find(i);
    atomsIn.set(r, (atomsIn.get(r) ?? 0) + 1);
  }
  for (const b of heavyBonds) {
    const r = find(b.from);
    bondsIn.set(r, (bondsIn.get(r) ?? 0) + 1);
  }
  for (const [r, atoms] of atomsIn) {
    if ((bondsIn.get(r) ?? 0) >= atoms) return true;
  }
  return false;
}

/** Structural sanity gate (fragments, charge) — checked BEFORE perception. */
function structuralRejectReason(graph: MolGraph): string | null {
  if (graph.fragmentCount > 1) return "multiple fragments — arrives in a later tier";
  if (graph.atoms.some((a) => a.charge !== 0)) return "contains a charged atom — later tier";
  return null;
}

/** True if the molecule contains at least one ring atom. */
function hasRing(graph: MolGraph): boolean {
  return graph.atoms.some((a) => a.ringIds.length > 0) || hasHeavyAtomCycle(graph);
}

/** Map principal group kind to suffix kind (only for suffix-path groups). */
function toSuffixKind(k: GroupKind): SuffixKind {
  const map: Partial<Record<GroupKind, SuffixKind>> = {
    acid: "oic acid",
    amide: "amide",
    nitrile: "nitrile",
    aldehyde: "al",
    ketone: "one",
    alcohol: "ol",
    amine: "amine",
  };
  return map[k]!;
}

/** Whether a PCG kind uses a dedicated two-part naming path (not the suffix path). */
function isTwoPart(k: GroupKind): k is "acylHalide" | "ester" | "anhydride" {
  return k === "acylHalide" || k === "ester" || k === "anhydride";
}

/** Prefix form of a non-principal group. */
function prefixForm(g: Group): string {
  switch (g.kind) {
    case "alcohol": return "hydroxy";
    case "ketone": return "oxo";
    case "aldehyde": return "oxo";
    case "amine": return "amino";
    case "acid": return "carboxy";
    case "halide": return {
      F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo",
    }[g.detail ?? ""] ?? "halo";
    case "ether": return `${g.detail ?? "alkyl"}oxy`;
    case "nitro": return "nitro";
    case "amide": return "carbamoyl";
    case "nitrile": return "cyano";
    // Two-part groups that become prefixes when not the PCG:
    case "acylHalide": return "haloformyl"; // uncommon; decline handled by completeness guard
    case "ester": return "alkoxycarbonyl"; // handled by completeness guard in practice
    case "anhydride": return "anhydride"; // handled by completeness guard in practice
  }
}

/**
 * Return the alkoxy prefix name and the chain-side carbon index for an ether group,
 * without needing to know the chain yet. The alkoxy side is identified as the SMALLER
 * carbon subtree reachable from the ether O.
 * Returns { prefix: "methoxy"|"ethoxy"|..., chainC: number } or null if indeterminate.
 */
function etherPrefixAndChainC(graph: MolGraph, etherGroup: Group): { prefix: string; chainC: number } | null {
  const oAtom = etherGroup.atoms[0]; // the O atom index
  const stems = [
    "", "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec",
  ];
  // Get both C neighbors of the O
  const cNbrs: number[] = [];
  for (const b of graph.bonds) {
    const nbr = b.from === oAtom ? b.to : b.to === oAtom ? b.from : -1;
    if (nbr >= 0 && graph.atoms.find((a) => a.index === nbr)?.element === "C") cNbrs.push(nbr);
  }
  if (cNbrs.length !== 2) return null;

  // Count carbons in each subtree (blocked at the O)
  const countCarbons = (start: number): number => {
    const visited = new Set<number>([oAtom]);
    const stack = [start];
    let count = 0;
    while (stack.length) {
      const u = stack.pop()!;
      if (visited.has(u)) continue;
      visited.add(u);
      if (graph.atoms.find((a) => a.index === u)?.element === "C") count++;
      for (const b of graph.bonds) {
        const nbr = b.from === u ? b.to : b.to === u ? b.from : -1;
        if (nbr >= 0 && !visited.has(nbr)) stack.push(nbr);
      }
    }
    return count;
  };

  const counts = cNbrs.map(countCarbons);
  // The alkoxy side is the smaller subtree (or arbitrarily cNbrs[0] if equal)
  const alkoxyIdx = counts[0] <= counts[1] ? 0 : 1;
  const chainIdx = 1 - alkoxyIdx;
  const n = counts[alkoxyIdx];
  const prefix = n >= 1 && n < stems.length ? `${stems[n]}oxy` : "alkoxy";
  return { prefix, chainC: cNbrs[chainIdx] };
}

/** Compute the alkoxy stem for an ether group. Returns e.g. "methoxy", "ethoxy". */
function etherPrefixFor(graph: MolGraph, etherGroup: Group, chainCarbons: Set<number>): string {
  // The ether O is attached to exactly 2 C atoms. The anchor (etherGroup.carbon)
  // is the chain carbon. The OTHER C side is the alkoxy substituent.
  const oAtom = etherGroup.atoms[0]; // the O atom index
  const bonds = graph.bonds.filter((b) => b.from === oAtom || b.to === oAtom);
  // The alkoxy side is the O-carbon that is NOT on the main chain (regardless of
  // which carbon perception happened to record as the anchor).
  const otherC = bonds
    .map((b) => (b.from === oAtom ? b.to : b.from))
    .find((idx) => !chainCarbons.has(idx));
  if (otherC === undefined) {
    // Both C sides are in chain — shouldn't happen in a well-formed ether;
    // use anchor C as fallback.
    return "alkoxy";
  }
  // Count the carbons reachable from otherC (not crossing back through the O)
  // to get the alkyl chain length.
  const visited = new Set<number>([oAtom]);
  const stack = [otherC];
  const alkylCarbons: number[] = [];
  while (stack.length) {
    const u = stack.pop()!;
    if (visited.has(u)) continue;
    visited.add(u);
    if (graph.atoms.find((a) => a.index === u)?.element === "C") alkylCarbons.push(u);
    for (const b of graph.bonds) {
      const nbr = b.from === u ? b.to : b.to === u ? b.from : -1;
      if (nbr !== -1 && !visited.has(nbr)) stack.push(nbr);
    }
  }
  const stems = [
    "", "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec",
  ];
  const n = alkylCarbons.length;
  return n >= 1 && n < stems.length ? `${stems[n]}oxy` : "alkoxy";
}

/** All carbon atoms in the subtree rooted at `start`, blocked at `from`. */
function subtreeAtoms(cg: CarbonGraph, start: number, from: number): Set<number> {
  const seen = new Set<number>([from]);
  const stack = [start];
  const out = new Set<number>();
  while (stack.length) {
    const u = stack.pop()!;
    if (seen.has(u)) continue;
    seen.add(u);
    out.add(u);
    for (const v of cg.adj.get(u) ?? []) if (!seen.has(v)) stack.push(v);
  }
  return out;
}

/** Full-graph neighbour indices of an atom. */
function neighborsOf(graph: MolGraph, idx: number): number[] {
  const out: number[] = [];
  for (const b of graph.bonds) {
    if (b.from === idx) out.push(b.to);
    else if (b.to === idx) out.push(b.from);
  }
  return out;
}

/** Carbons reachable from `start` over C–C bonds without entering `chainSet`. */
function branchCarbons(cg: CarbonGraph, start: number, chainSet: Set<number>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const u = stack.pop()!;
    if (seen.has(u) || chainSet.has(u)) continue;
    seen.add(u);
    out.push(u);
    for (const v of cg.adj.get(u) ?? []) if (!seen.has(v) && !chainSet.has(v)) stack.push(v);
  }
  return out;
}

/**
 * Atoms on the alkoxy side of an ether (the O plus the other-side carbons), but
 * ONLY when exactly one O-carbon is on the chain and the other side is a simple
 * unbranched saturated carbon chain — all our `etherPrefixFor` can express.
 * Returns null otherwise, so the caller leaves the atoms unaccounted and the
 * molecule is declined rather than mis-named.
 */
function etherAlkoxyAtoms(graph: MolGraph, etherO: number, chainSet: Set<number>): Set<number> | null {
  const cNbrs = neighborsOf(graph, etherO);
  if (cNbrs.filter((n) => chainSet.has(n)).length !== 1) return null;
  const otherC = cNbrs.find((n) => !chainSet.has(n));
  if (otherC === undefined) return null;
  const set = new Set<number>([etherO]);
  const seen = new Set<number>([etherO]);
  const stack = [otherC];
  while (stack.length) {
    const u = stack.pop()!;
    if (seen.has(u)) continue;
    seen.add(u);
    set.add(u);
    if (graph.atoms.find((a) => a.index === u)?.element !== "C") return null; // hetero on alkoxy
    for (const v of neighborsOf(graph, u)) if (!seen.has(v)) stack.push(v);
  }
  for (const c of set) {
    if (c === etherO) continue;
    if (neighborsOf(graph, c).filter((n) => set.has(n)).length > 2) return null; // branched
  }
  for (const b of graph.bonds) {
    if (set.has(b.from) && set.has(b.to) && b.order > 1) return null; // unsaturated alkoxy
  }
  return set;
}

/**
 * Try to name a carbon branch that carries heteroatom substituents — specifically,
 * simple haloalkyl branches like CH2F (fluoromethyl), CHCl2 (dichloromethyl), etc.
 *
 * Returns the substituent name string, or null if the branch is not expressible this way
 * (e.g. multi-carbon, has non-halogen heteroatoms, or branched).
 *
 * This is used when the main-chain completeness guard would otherwise decline the name
 * because the engine can't account for halogens on carbon branches via nameSubstituent
 * (which only sees the carbon graph).
 */
function nameHaloalkylBranch(
  graph: MolGraph,
  branchRoot: number,
  chainParent: number,
  groupAtoms: Set<number>,
): string | null {
  const HAL_PREFIX: Record<string, string> = { F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo" };
  const HALS = new Set(["F", "Cl", "Br", "I"]);

  // Collect all non-H atoms reachable from branchRoot (blocked at chainParent)
  const visited = new Set<number>([chainParent]);
  const stack = [branchRoot];
  const branchAtoms: number[] = [];
  while (stack.length) {
    const u = stack.pop()!;
    if (visited.has(u)) continue;
    visited.add(u);
    const atom = graph.atoms.find((a) => a.index === u);
    if (!atom || atom.element === "H") continue;
    branchAtoms.push(u);
    for (const b of graph.bonds) {
      const nbr = b.from === u ? b.to : b.to === u ? b.from : -1;
      if (nbr >= 0 && !visited.has(nbr)) stack.push(nbr);
    }
  }

  // Categorize branch atoms
  const carbons = branchAtoms.filter(
    (idx) => graph.atoms.find((a) => a.index === idx)?.element === "C",
  );
  const halogens = branchAtoms.filter(
    (idx) => HALS.has(graph.atoms.find((a) => a.index === idx)?.element ?? ""),
  );
  const otherAtoms = branchAtoms.filter(
    (idx) => !carbons.includes(idx) && !halogens.includes(idx) && !groupAtoms.has(idx),
  );

  // Only handle simple haloalkyl: exactly 1 carbon, 1+ halogens, no other atoms
  if (carbons.length !== 1 || halogens.length === 0 || otherAtoms.length > 0) return null;
  // The single carbon must have no C-C bonds to other carbons (it IS the branch root)
  // and all non-H neighbors must be either chainParent or halogens
  const rootNeighbors = graph.bonds
    .filter((b) => b.from === branchRoot || b.to === branchRoot)
    .map((b) => (b.from === branchRoot ? b.to : b.from))
    .filter((idx) => graph.atoms.find((a) => a.index === idx)?.element !== "H");
  const unexpectedNeighbors = rootNeighbors.filter(
    (idx) => idx !== chainParent && !halogens.includes(idx),
  );
  if (unexpectedNeighbors.length > 0) return null; // other C or heteroatom → can't name

  // All halogens must be the same element for simple di/trihalomethyl (mixed is unusual)
  const halElements = halogens.map(
    (idx) => graph.atoms.find((a) => a.index === idx)?.element ?? "X",
  );
  // Build prefix: di/tri prefix + halogen name + methyl
  const stems = ["", "", "di", "tri", "tetra"];
  const pfx = halElements.length < stems.length ? stems[halElements.length] : `${halElements.length}-`;
  if (new Set(halElements).size === 1) {
    // All same: dichloromethyl, fluoromethyl, etc.
    return `${pfx}${HAL_PREFIX[halElements[0]] ?? "halo"}methyl`;
  }
  // Mixed halogens: alphabetize and concatenate (e.g. bromochloromethyl)
  const sortedHal = [...halElements].sort((a, b) => (HAL_PREFIX[a] ?? a) < (HAL_PREFIX[b] ?? b) ? -1 : 1);
  return sortedHal.map((h) => HAL_PREFIX[h] ?? "halo").join("") + "methyl";
}

// ── Acyl-chain naming helpers ─────────────────────────────────────────────────

/** The acid stem for an acyl chain (e.g. "ethanoic", "prop-2-enoic"). Used for anhydrides. */
function acidStem(chainLen: number, doubles: number[], triples: number[], subs: Sub[]): string {
  // Derive from acylName (ends in "oyl") by replacing the suffix: "oyl" → "oic".
  // e.g. "ethanoyl" → "ethanoic", "prop-2-enoyl" → "prop-2-enoic".
  const acyl = acylName(chainLen, doubles, triples, subs);
  if (acyl.endsWith("oyl")) return acyl.slice(0, -3) + "oic";
  return acyl; // fallback (shouldn't happen)
}

/**
 * Name the acyl chain starting from acylCarbonIdx.
 * Returns { chainLen, doubles, triples, subs, chainAtoms } or null if not expressible.
 *
 * The acyl carbon (C1) must be a chain terminus; we walk the carbon tree from it.
 * All C-C bonds in the acyl chain are ene/yne on the main chain; any branch must
 * be a simple alkyl substituent (no heteroatoms, no double/triple bonds to branches).
 */
function describeAcylChain(
  cg: CarbonGraph,
  acylCarbonIdx: number,
  groupAtomSet: Set<number>,
): { chainLen: number; doubles: number[]; triples: number[]; subs: Sub[]; chainAtoms: number[] } | null {
  // Build a carbon chain starting from acylCarbonIdx, treating it as C1.
  // The acyl carbon connects to the rest of the molecule via its non-group C-C bonds.
  const acylAdj = (cg.adj.get(acylCarbonIdx) ?? []).filter((n) => !groupAtomSet.has(n));

  // Compute all paths starting from acylCarbonIdx through the carbon graph (excluding group atoms)
  // Pick the longest chain that starts at acylCarbonIdx (it must be a terminus = C1).
  // In a simple acyclic acyl chain, there's exactly one path going "inward" from acylC.
  if (acylAdj.length > 1) {
    // acylC branches → either it's a diacid or the chain has substitution at C1.
    // For the diacyl case (acyl halide or anhydride where one acylC has multiple C bonds),
    // we need to find the longest chain through acylC.
    // For now, try to find a single longest chain starting at acylC.
    // We'll use BFS to find the farthest carbon, then the path is the chain.
  }

  // BFS/DFS from acylCarbonIdx to find the maximal carbon chain it can be C1 of.
  // "C1" of acyl chain means it has fewest other C-C bonds (terminal); it must be a terminus
  // in the chain we select. Find all leaves reachable and pick longest path from acylCarbonIdx.
  function longestPathFrom(start: number, blocked: Set<number>): number[] {
    let best: number[] = [start];
    function dfs(path: number[]) {
      const cur = path[path.length - 1];
      const nexts = (cg.adj.get(cur) ?? []).filter((n) => !blocked.has(n) && !path.includes(n) && !groupAtomSet.has(n));
      if (nexts.length === 0) {
        if (path.length > best.length) best = [...path];
        return;
      }
      for (const n of nexts) { path.push(n); dfs(path); path.pop(); }
    }
    dfs([start]);
    return best;
  }

  const chainAtoms = longestPathFrom(acylCarbonIdx, new Set<number>());

  // Verify that acylCarbonIdx is indeed C1 (first in chainAtoms = start)
  if (chainAtoms[0] !== acylCarbonIdx) return null;

  const chainLen = chainAtoms.length;
  const inChain = new Set(chainAtoms);

  // Collect ene/yne locants along the chain
  const doubles: number[] = [];
  const triples: number[] = [];
  for (let i = 0; i < chainAtoms.length - 1; i++) {
    const o = ccOrder(cg, chainAtoms[i], chainAtoms[i + 1]);
    if (o === 2) doubles.push(i + 1);
    if (o === 3) triples.push(i + 1);
  }

  // Collect substituents (alkyl branches off the chain)
  const subs: Sub[] = [];
  for (let i = 0; i < chainAtoms.length; i++) {
    for (const nb of cg.adj.get(chainAtoms[i]) ?? []) {
      if (!inChain.has(nb) && !groupAtomSet.has(nb)) {
        // Branch off the chain: must be a simple alkyl group
        subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, chainAtoms[i]) });
      }
    }
  }

  return { chainLen, doubles, triples, subs, chainAtoms };
}

/**
 * Get all carbons reachable from `startC` crossing the ester bridging O,
 * i.e. the O-alkyl side of the ester.
 * Returns null if not a simple expressible chain (heteroatoms, branching, unsaturation).
 */
function describeOAlkylChain(
  graph: MolGraph,
  cg: CarbonGraph,
  bridgeOIdx: number,
  acylCarbonIdx: number,
): { alkylName: string; alkylAtoms: Set<number> } | null {
  // From the bridging O, go to the C that is NOT the acylCarbon side
  const oNbrs = graph.bonds
    .filter((b) => (b.from === bridgeOIdx || b.to === bridgeOIdx) && b.order === 1)
    .map((b) => (b.from === bridgeOIdx ? b.to : b.from));

  const oAlkylC = oNbrs.find((n) => n !== acylCarbonIdx && graph.atoms.find((a) => a.index === n)?.element === "C");
  if (oAlkylC === undefined) return null;

  // Collect all atoms reachable from oAlkylC without going back through bridgeOIdx
  // All must be C atoms forming a simple alkyl chain
  const alkylAtoms = new Set<number>([bridgeOIdx]);
  const visited = new Set<number>([bridgeOIdx]);
  const stack = [oAlkylC];
  while (stack.length) {
    const u = stack.pop()!;
    if (visited.has(u)) continue;
    visited.add(u);
    const atom = graph.atoms.find((a) => a.index === u);
    if (!atom) continue;
    if (atom.element !== "C") return null; // heteroatom on alkyl side → can't express
    alkylAtoms.add(u);
    for (const b of graph.bonds) {
      const nbr = b.from === u ? b.to : b.to === u ? b.from : -1;
      if (nbr !== -1 && !visited.has(nbr)) stack.push(nbr);
    }
  }

  // Verify: no unsaturated bonds within the alkyl portion (except through the C-C graph)
  for (const b of graph.bonds) {
    if (alkylAtoms.has(b.from) && alkylAtoms.has(b.to) && b.from !== bridgeOIdx && b.to !== bridgeOIdx) {
      if (b.order > 1) return null; // unsaturated O-alkyl side → can't express
    }
  }

  // Use nameSubstituent on the first carbon (oAlkylC) — treated as root with blocked=bridgeOIdx.
  // nameSubstituent uses the CarbonGraph (cg) which only has C-C edges, so the bridging O
  // is naturally not traversed; oAlkylC is the root and bridgeOIdx acts as the block.
  const alkyl = nameSubstituent(cg, oAlkylC, bridgeOIdx);

  return { alkylName: alkyl, alkylAtoms };
}

// ── Helpers for ring path ─────────────────────────────────────────────────────

/** Get all non-ring neighbors of a ring atom (substituent attachment points). */
function ringSubstituents(
  graph: MolGraph,
  ringSet: Set<number>,
): Map<number, number[]> {
  // Returns map: ring atom index → [non-ring heavy atom neighbors]
  const result = new Map<number, number[]>();
  for (const idx of ringSet) {
    const nonRingNbrs: number[] = [];
    for (const b of graph.bonds) {
      if (b.from === idx) {
        if (!ringSet.has(b.to) && graph.atoms.find(a => a.index === b.to)?.element !== "H") {
          nonRingNbrs.push(b.to);
        }
      } else if (b.to === idx) {
        if (!ringSet.has(b.from) && graph.atoms.find(a => a.index === b.from)?.element !== "H") {
          nonRingNbrs.push(b.from);
        }
      }
    }
    if (nonRingNbrs.length > 0) result.set(idx, nonRingNbrs);
  }
  return result;
}

/** True if atom `idx` is directly bonded to a ring atom in `ringSet` (the attached exocyclic carbon). */
function isDirectlyAttachedToRing(graph: MolGraph, idx: number, ringSet: Set<number>): boolean {
  return graph.bonds.some(b =>
    (b.from === idx && ringSet.has(b.to)) || (b.to === idx && ringSet.has(b.from))
  );
}

// ── Tier 4 Stage 1: cyclic carbonyl naming ───────────────────────────────────

/**
 * Parent names for saturated cyclic carbonyl (lactam/lactone) formation.
 * Maps the saturated heterocycle name → name with trailing 'e' elided (ready for -one suffix).
 */
const SATURATED_CYCLIC_PARENT_BASE: Record<string, string> = {
  // Lactams (N-heterocycles)
  azetidine: "azetidin",     // azetidin-2-one
  pyrrolidine: "pyrrolidin", // pyrrolidin-2-one
  piperidine: "piperidin",   // piperidin-2-one
  azepane: "azepan",         // azepan-2-one
  // Lactones (O-heterocycles)
  oxetane: "oxetan",         // oxetan-2-one
  oxolane: "oxolan",         // oxolan-2-one
  oxane: "oxan",             // oxan-2-one
  oxepane: "oxepan",         // oxepan-2-one
};

/**
 * Handle Tier 4 Stage 1 cyclic carbonyls: lactams, lactones, and aromatic ring-carbonyls.
 *
 * Returns a NameResult (named or unsupported) or null if the case is outside our scope
 * (the caller will then fall back to the old decline).
 *
 * Called when:
 * (a) cyclicCarbonylGroups.length > 0 (ring C with exo =O and in-ring heteroatom), OR
 * (b) the ring has ring double bonds AND a ring C has an exo =O (mancude ring-carbonyl)
 */
function nameCyclicCarbonyl(
  graph: MolGraph,
  ring: RingInfo,
  ringSet: Set<number>,
  _allGroups: Group[],
  cyclicCarbonylGroups: Group[],
): NameResult | null {
  // ── Determine if saturated or mancude/aromatic ring-carbonyl ──────────────
  // "Saturated" means: the ring has NO double bonds among ring-ring bonds.
  // The exocyclic C=O is not a ring bond.
  const ringDoubleBonds = graph.bonds.filter(
    b => b.order === 2 && ringSet.has(b.from) && ringSet.has(b.to)
  );
  const isSaturatedRing = ringDoubleBonds.length === 0;

  if (isSaturatedRing) {
    return nameSaturatedLactamLactone(graph, ring, ringSet, cyclicCarbonylGroups);
  } else {
    return nameAromaticRingCarbonyl(graph, ring, ringSet);
  }
}

/**
 * Name a saturated lactam or lactone, including substituted variants.
 *
 * Strategy:
 * 1. Verify exactly ONE cyclic carbonyl group (amide or ester kind).
 * 2. Collect ring substituents (halogens and simple alkyl/haloalkyl on ring C atoms,
 *    and simple substituents on the ring heteroatom for N-substituted lactams).
 * 3. Build the IUPAC-fixed locant map: heteroatom=1, carbonyl C=2, then ascending
 *    around the ring in the direction that gives lowest locants to substituents.
 * 4. Name each substituent; if any is not expressible → DECLINE (no wrong names).
 * 5. Assemble: prefixes + stem + "-2-one".
 */
function nameSaturatedLactamLactone(
  graph: MolGraph,
  ring: import("./ring").RingInfo,
  ringSet: Set<number>,
  cyclicCarbonylGroups: Group[],
): NameResult | null {
  // Only handle rings with exactly ONE cyclic carbonyl for now.
  if (cyclicCarbonylGroups.length !== 1) {
    return null; // multiple ring carbonyls → decline (later Tier 4)
  }

  const carbonylGroup = cyclicCarbonylGroups[0];
  // Verify this is an amide (lactam) or ester (lactone) — these are the supported kinds
  if (carbonylGroup.kind !== "amide" && carbonylGroup.kind !== "ester") {
    return null;
  }

  // The exocyclic =O atom
  const exoOIdx = carbonylGroup.atoms.find(a => !ringSet.has(a));
  if (exoOIdx === undefined) return null;
  const exoOAtom = graph.atoms.find(a => a.index === exoOIdx);
  if (!exoOAtom || exoOAtom.element !== "O") return null;

  const atomById = new Map(graph.atoms.map(a => [a.index, a]));
  const HAL_ELEMENTS = new Set(["F", "Cl", "Br", "I"]);
  const HAL_PREFIX: Record<string, string> = { F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo" };

  // ── Collect exocyclic substituents on ring atoms ──────────────────────────────
  // List of (ring atom index, substituent name) pairs.
  // Multiple substituents on the same ring atom are allowed (gem-disubstitution).
  const ringAtomSubList: { ringAtomIdx: number; subName: string }[] = [];

  // Build exo carbon graph (non-ring carbons only) for nameSubstituent
  const exoCg = buildCarbonGraph(graph);
  for (const idx of ringSet) {
    exoCg.carbons = exoCg.carbons.filter(c => c !== idx);
    exoCg.adj.delete(idx);
    for (const [, list] of exoCg.adj) {
      const i = list.indexOf(idx);
      if (i >= 0) list.splice(i, 1);
    }
  }

  for (const ringAtomIdx of ring.atoms) {
    for (const b of graph.bonds) {
      const nbr = b.from === ringAtomIdx ? b.to : b.to === ringAtomIdx ? b.from : -1;
      if (nbr < 0) continue;
      if (ringSet.has(nbr)) continue; // ring bond
      const nbrAtom = atomById.get(nbr);
      if (!nbrAtom || nbrAtom.element === "H") continue;
      // Exocyclic heavy atom: must be accounted for
      if (nbr === exoOIdx) continue; // the carbonyl =O — handled as suffix

      // Name the substituent
      if (HAL_ELEMENTS.has(nbrAtom.element)) {
        // Direct halogen substituent
        ringAtomSubList.push({ ringAtomIdx, subName: HAL_PREFIX[nbrAtom.element] });
      } else if (nbrAtom.element === "C") {
        // Alkyl substituent: must be a simple chain with no ring atoms
        // Check that the substituent subtree contains no ring atoms and no heteroatoms
        // that aren't captured by nameSubstituent
        const subAtoms = collectSubtreeAtoms(exoCg, nbr, ringAtomIdx);
        // Verify all atoms in subtree are carbons (exoCg only tracks C-C bonds,
        // but check the full graph for heteroatoms in the subtree)
        let hasHeteroInSub = false;
        for (const subC of subAtoms) {
          // Check non-ring, non-H neighbors of subC for heteroatoms
          for (const sb of graph.bonds) {
            const sn = sb.from === subC ? sb.to : sb.to === subC ? sb.from : -1;
            if (sn < 0) continue;
            const snAtom = atomById.get(sn);
            if (!snAtom || snAtom.element === "H") continue;
            if (snAtom.element !== "C" && !ringSet.has(sn)) {
              hasHeteroInSub = true;
              break;
            }
          }
          if (hasHeteroInSub) break;
        }
        if (hasHeteroInSub) {
          // Complex substituent (heteroatom in the alkyl branch) — decline
          return null;
        }
        const subName = nameSubstituent(exoCg, nbr, ringAtomIdx);
        ringAtomSubList.push({ ringAtomIdx, subName });
      } else {
        // Other element (O, N, S, etc.) not as halide → decline
        return null;
      }
    }
  }

  // ── Get the parent ring name to determine the parent stem ─────────────────────
  // We call nameRing to get the parent name (e.g. "pyrrolidine", "piperidine").
  // This also gives us the heteroatom's index for building our custom locant map.
  const ringNaming = nameRing(graph, ring, {});
  if (!ringNaming) return null;
  if (ringNaming.kind !== "heterocycle") return null; // only heterocycles produce lactams/lactones

  const parentName = ringNaming.parent;

  // Look up the e-elided stem
  const stem = SATURATED_CYCLIC_PARENT_BASE[parentName];
  if (!stem) return null; // parent not in our table

  // ── Build the fixed lactam/lactone locant map ─────────────────────────────────
  // IUPAC convention: heteroatom = 1, carbonyl C = 2. The carbonyl C is one of the
  // two ring neighbors of the heteroatom. The direction (which neighbor is 2 vs n)
  // is already fixed by this constraint (only one neighbor of the heteroatom is
  // the carbonyl C). Then for substituents we choose the ring traversal direction
  // that gives the lowest locant set.
  //
  // Find the single ring heteroatom (N or O):
  if (ring.heteroatoms.length !== 1) {
    return null; // multiple heteroatoms → not a simple lactam/lactone
  }
  const heteroIdx = ring.heteroatoms[0];

  // Find the two ring neighbors of the heteroatom
  const n = ring.size;
  const heteroPos = ring.atoms.indexOf(heteroIdx);
  if (heteroPos < 0) return null;

  const nextPos = (heteroPos + 1) % n;
  const prevPos = ((heteroPos - 1) % n + n) % n;
  const nextAtomIdx = ring.atoms[nextPos];
  const prevAtomIdx = ring.atoms[prevPos];

  // Determine which neighbor is the carbonyl C (must have an exo =O at exoOIdx)
  const carbonylCIdx = carbonylGroup.carbon;
  let direction: "forward" | "backward";
  if (nextAtomIdx === carbonylCIdx) {
    direction = "forward"; // heteroatom→C=O is the forward direction
  } else if (prevAtomIdx === carbonylCIdx) {
    direction = "backward";
  } else {
    return null; // carbonyl C is not adjacent to heteroatom — shouldn't happen for a lactam
  }

  // Build the locant map: heteroatom=1, carbonyl=2, then ascending
  // In the "forward" direction: atoms are ring.atoms[heteroPos], ring.atoms[heteroPos+1], ...
  // In the "backward" direction: atoms are ring.atoms[heteroPos], ring.atoms[heteroPos-1], ...
  const buildLocantMap = (fwd: boolean): Map<number, number> => {
    const m = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const pos = fwd ? (heteroPos + i) % n : ((heteroPos - i) % n + n) % n;
      m.set(ring.atoms[pos], i + 1);
    }
    return m;
  };

  // The carbonyl C must be at locant 2 — this is fixed by IUPAC convention.
  // Only the "correct" direction (that puts carbonylCIdx at locant 2) is valid.
  // We've already determined this direction above. But for rings where substituent
  // positions can be minimized by trying different directions from the SAME start,
  // note that the start is always the heteroatom and the carbonyl must be at 2,
  // so there's only ONE valid direction. We use it directly.
  const isFwd = direction === "forward";
  const locantOf = buildLocantMap(isFwd);

  // Verify carbonyl gets locant 2
  const carbonylLoc = locantOf.get(carbonylCIdx);
  if (carbonylLoc !== 2) return null; // safety check

  // ── Assign substituent locants and check expressibility ──────────────────────
  const ringNameSubs: { locant: number; name: string }[] = [];

  for (const { ringAtomIdx, subName } of ringAtomSubList) {
    const loc = locantOf.get(ringAtomIdx);
    if (loc === undefined) return null;
    ringNameSubs.push({ locant: loc, name: subName });
  }

  // ── Build the prefix string ───────────────────────────────────────────────────
  // Group substituents by name, sort alphabetically, assemble locant-prefixed string.
  // This mirrors the ring substituent assembly in assembleRingName / prefixSegmentRing.
  const prefixStr = buildLactamPrefix(ringNameSubs);

  // The name is: prefix + stem + "-2-one"
  const finalName = prefixStr + stem + "-2-one";
  return { name: finalName, status: "named" };
}

/**
 * Build a prefix string for lactam/lactone substituents.
 * Format: "5-methyl-" or "1-methyl-" or "5-chloro-" etc.
 * Multiple substituents: sorted alphabetically with locants always cited.
 */
function buildLactamPrefix(subs: { locant: number; name: string }[]): string {
  if (subs.length === 0) return "";

  // Group by substituent name
  const groups = new Map<string, number[]>();
  for (const s of subs) {
    const arr = groups.get(s.name) ?? [];
    arr.push(s.locant);
    groups.set(s.name, arr);
  }

  // Sort alphabetically (strip leading digits for sort key, same as assembleRingName)
  const alphaKey = (name: string) =>
    name.replace(/^\((.*)\)$/, "$1").replace(/^[\d,()\-\s]+/, "");

  const parts = [...groups.entries()].map(([name, locants]) => ({
    name,
    locants: locants.sort((a, b) => a - b),
  }));
  parts.sort((a, b) => {
    const ka = alphaKey(a.name), kb = alphaKey(b.name);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Multiplier prefixes: "di", "tri", etc.
  const multPfx = (n: number) => ["", "", "di", "tri", "tetra"][n] ?? `${n}-`;
  // Complex names (containing digits) get wrapped in parens
  const isComplex = (n: string) => /\d/.test(n);
  const disp = (n: string) => isComplex(n) ? `(${n})` : n;

  const segments = parts.map(p =>
    `${p.locants.join(",")}-${multPfx(p.locants.length)}${disp(p.name)}`
  );

  // Join segments with hyphens; add trailing hyphen to separate from the parent stem.
  // However IUPAC names like "4-methylazetidin-2-one" show that when the substituent
  // name itself is a simple alphabetic word (no internal digits), the concatenation is
  // direct: "4-methyl" + "azetidin-2-one" = "4-methylazetidin-2-one".
  // So we join all segments with "-" between them but do NOT add a trailing "-".
  // The caller appends the stem directly (e.g. stem = "azetidin", "pyrrolidin").
  return segments.join("-");
}

/**
 * Name an aromatic/mancude ring carbonyl with indicated hydrogen.
 *
 * Handles pyridinones, pyranones, uracil-type diones.
 * OPSIN-round-trip invariant: decline if indicated-H cannot be reliably computed.
 *
 * Strategy:
 * 1. Collect all ring C atoms with an exocyclic =O (carbonyl positions).
 * 2. Collect ring heteroatoms with H (indicated-H sites).
 * 3. Look up the AROMATIC heterocycle parent via a modified ring info (aromaticity forced).
 * 4. Assign locants; build the name with indicated-H suffix notation.
 *
 * For pyranone (O with no H, C-H is the indicated-H site): special 2H-pyran-2-one form.
 * Returns a NameResult or { name: null, status: "unsupported" } (never null).
 */
function nameAromaticRingCarbonyl(
  graph: MolGraph,
  ring: RingInfo,
  ringSet: Set<number>,
): NameResult {
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));

  // Collect all exocyclic =O atoms on ring carbons (carbonyl Cs)
  const exoCarbonylO: { ringC: number; oIdx: number }[] = [];
  for (const rIdx of ring.atoms) {
    const rAtom = atomById.get(rIdx);
    if (!rAtom || rAtom.element !== "C") continue;
    for (const b of graph.bonds) {
      if (b.order !== 2) continue;
      const oIdx = b.from === rIdx ? b.to : b.to === rIdx ? b.from : -1;
      if (oIdx < 0) continue;
      if (ringSet.has(oIdx)) continue; // ring bond, not exo =O
      const oAtom = atomById.get(oIdx);
      if (oAtom?.element === "O") {
        exoCarbonylO.push({ ringC: rIdx, oIdx });
      }
    }
  }

  if (exoCarbonylO.length === 0) {
    return { name: null, status: "unsupported", reason: "mancude ring — no ring-carbonyl found" };
  }

  // Verify no exocyclic substituents other than carbonyl oxygens
  const carbonylOSet = new Set(exoCarbonylO.map(x => x.oIdx));
  for (const rIdx of ring.atoms) {
    for (const b of graph.bonds) {
      const nbr = b.from === rIdx ? b.to : b.to === rIdx ? b.from : -1;
      if (nbr < 0 || ringSet.has(nbr)) continue;
      const nbrAtom = atomById.get(nbr);
      if (!nbrAtom || nbrAtom.element === "H") continue;
      if (!carbonylOSet.has(nbr)) {
        return { name: null, status: "unsupported", reason: "mancude ring carbonyl with additional substituents — not yet supported" };
      }
    }
  }

  // Collect ring heteroatoms with H (indicated-H candidates)
  const indicatedHAtoms = ring.heteroatoms.filter(idx => (atomById.get(idx)?.hydrogens ?? 0) >= 1);

  // Look up the aromatic parent by creating a "forced-aromatic" ring info.
  // The mancude ring carbonyl's parent is the aromatic heterocycle (e.g. pyridine, pyrimidine, pyran).
  // We match by creating a modified ring info where aromatic = true.
  const aromaticRing: RingInfo = {
    atoms: ring.atoms,
    size: ring.size,
    aromatic: true,
    heteroatoms: ring.heteroatoms,
  };
  const aromaticNaming = nameRing(graph, aromaticRing, {});
  if (!aromaticNaming || aromaticNaming.kind !== "heterocycle") {
    return { name: null, status: "unsupported", reason: "aromatic ring carbonyl — parent ring not recognized" };
  }

  const parentName = aromaticNaming.parent;
  const locantOf = aromaticNaming.locantOf;

  // Carbonyl locants (sorted ascending)
  const carbonylLocs = exoCarbonylO
    .map(x => locantOf.get(x.ringC))
    .filter((l): l is number => l !== undefined)
    .sort((a, b) => a - b);

  if (carbonylLocs.length !== exoCarbonylO.length) {
    return { name: null, status: "unsupported", reason: "aromatic ring carbonyl — could not assign carbonyl locants" };
  }

  // Indicated-H locants (sorted ascending)
  const indicatedHLocs = indicatedHAtoms
    .map(idx => locantOf.get(idx))
    .filter((l): l is number => l !== undefined)
    .sort((a, b) => a - b);

  // ── Case A/B: N-heterocycle with N-H indicated hydrogen (pyridinone, uracil) ──
  if (indicatedHLocs.length > 0) {
    const indicatedHStr = indicatedHLocs.map(l => `${l}H`).join(",");
    let nameTxt: string;
    if (carbonylLocs.length === 1) {
      // suffix "-one" starts with vowel → apply e-elision (pyridine → pyridin-2(1H)-one)
      const stem = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
      nameTxt = `${stem}-${carbonylLocs[0]}(${indicatedHStr})-one`;
    } else {
      // suffix "-dione"/"-trione" starts with consonant → no e-elision (pyrimidine-2,4(1H,3H)-dione)
      const multPfx = carbonylLocs.length === 2 ? "di" : carbonylLocs.length === 3 ? "tri" : "";
      nameTxt = `${parentName}-${carbonylLocs.join(",")}(${indicatedHStr})-${multPfx}one`;
    }
    return { name: nameTxt, status: "named" };
  }

  // ── Case C: O-heterocycle pyranone — 2H-pyran-2-one ──
  // For 2H-pyran-2-one (O=c1cccco1): the ring O has no H, so indicatedHLocs is empty.
  // The "2H" prefix form is the IUPAC standard for this compound.
  // Per IUPAC P-31.1.3.4: when indicated hydrogen is at the same position as the ketone,
  // the name takes the form "2H-pyran-2-one".
  // OPSIN parses "2H-pyran-2-one" and "pyran-2-one" both to the same structure.
  if (parentName === "pyran" && carbonylLocs.length === 1) {
    const loc = carbonylLocs[0];
    return { name: `2H-pyran-${loc}-one`, status: "named" };
  }

  // Cannot determine indicated H → decline (no wrong name)
  return { name: null, status: "unsupported", reason: "aromatic ring carbonyl — could not determine indicated hydrogen" };
}

/**
 * Tier 4, Stage 2: name a fused (ortho-fused) multi-ring system.
 * Uses the curated fused ring table + isomorphism locant transfer.
 * For Task 2: bare ring systems (no substituents, no functional groups).
 * Task 3 will add substituents + functional groups.
 */
function nameFusedRingSystem(
  graph: MolGraph,
  ringSys: import("./ring").RingSystemInfo,
): NameResult {
  // Check element support: ring atoms may be C/N/O/S; exocyclic atoms may also be halogens
  const FUSED_RING_ELEMENTS = new Set(["C", "H", "N", "O", "S"]);
  const FUSED_EXO_ELEMENTS = new Set(["C", "H", "N", "O", "S", "F", "Cl", "Br", "I"]);
  for (const a of graph.atoms) {
    if (!FUSED_EXO_ELEMENTS.has(a.element)) {
      return { name: null, status: "unsupported", reason: `fused ring system contains ${a.element} — not yet supported in Tier 4 (Stage 2)` };
    }
    // Ring atoms must be C/N/O/S (no halogens in ring skeleton)
    if (ringSys.atoms.has(a.index) && !FUSED_RING_ELEMENTS.has(a.element)) {
      return { name: null, status: "unsupported", reason: `ring atom ${a.element} in fused system — not yet supported` };
    }
  }

  // Check that all heavy atoms are ring atoms (Task 2: no substituents allowed yet)
  const heavy = graph.atoms.filter(a => a.element !== "H");
  const ringAtoms = ringSys.atoms;
  const nonRingHeavy = heavy.filter(a => !ringAtoms.has(a.index));

  if (nonRingHeavy.length > 0) {
    // Has exocyclic substituents: route to Task 3 handler
    return nameFusedRingWithSubs(graph, ringSys);
  }

  // Pure fused ring (no exocyclic substituents): look up in curated table
  const naming = nameFusedRing(graph, ringSys, {});
  if (!naming) {
    return { name: null, status: "unsupported", reason: "fused ring system not in curated table — Tier 4 (general fusion, later stage)" };
  }

  return { name: naming.parent, status: "named" };
}

/**
 * Name a fused ring system that has exocyclic substituents or functional groups.
 * Task 3: substituents + functional groups + ring-as-substituent.
 *
 * Cases handled:
 *  - Fused ring as parent: substituents/FG on ring atoms (e.g. 2-methylnaphthalene)
 *  - Exocyclic PCG on added carbon (e.g. naphthalene-2-carboxylic acid)
 *  - Fused ring as substituent: chain is parent (e.g. 2-(naphthalen-2-yl)acetic acid)
 */
function nameFusedRingWithSubs(
  graph: MolGraph,
  ringSys: import("./ring").RingSystemInfo,
): NameResult {
  const heavy = graph.atoms.filter(a => a.element !== "H");
  const ringAtoms = ringSys.atoms;

  // Perceive functional groups
  const perception = perceiveGroups(graph);
  if (perception.unsupported) {
    return { name: null, status: "unsupported", reason: perception.unsupported };
  }

  // Filter out groups that are entirely inside the ring (ring heteroatoms)
  const allGroups = perception.groups.filter(g => {
    const allInRing = g.atoms.every(a => ringAtoms.has(a));
    return !allInRing;
  }).filter(g => {
    // Ether: O between two ring atoms → ring itself; skip
    if (g.kind === "ether" && ringAtoms.has(g.carbon) && ringAtoms.has(g.atoms[0])) return false;
    return true;
  });
  const groups = allGroups;

  // Verify all heteroatoms are accounted for
  {
    const groupAtomSet = new Set<number>();
    for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);
    for (const a of graph.atoms) {
      if (a.element === "C" || a.element === "H") continue;
      if (ringAtoms.has(a.index)) continue; // ring heteroatom (N, O, S)
      if (!groupAtomSet.has(a.index)) {
        const eName = { O: "oxygen", N: "nitrogen", S: "sulfur", F: "fluorine", Cl: "chlorine", Br: "bromine", I: "iodine" }[a.element] ?? a.element;
        return { name: null, status: "unsupported", reason: `contains unclassified ${eName} — functional group not recognized` };
      }
    }
  }

  const pcgKind = principalKind(groups);

  // Decline two-part names on fused rings (esters, acyl halides, anhydrides)
  if (groups.some(g => isTwoPart(g.kind))) {
    return { name: null, status: "unsupported", reason: "acid derivative on fused ring — not yet supported" };
  }

  // Check where PCG sits relative to the ring
  let pcgOnRingAtom = false;
  let pcgOnExocyclicC = false;
  let pcgOnChain = false;
  const pcgGroups = pcgKind ? groups.filter(g => g.kind === pcgKind) : [];

  for (const g of pcgGroups) {
    if (ringAtoms.has(g.carbon)) {
      pcgOnRingAtom = true;
    } else if (isDirectlyAttachedToRing(graph, g.carbon, ringAtoms)) {
      pcgOnExocyclicC = true;
    } else {
      pcgOnChain = true;
    }
  }

  // If PCG only on chain (not ring-adjacent) → fused ring as substituent
  if (pcgKind && pcgOnChain && !pcgOnRingAtom && !pcgOnExocyclicC) {
    return nameMoleculeFusedRingAsSubstituent(graph, ringSys, groups, pcgKind, pcgGroups);
  }

  // If PCG on exocyclic C but not expressible as added-carbon → ring-as-substituent path
  if (pcgKind && pcgOnExocyclicC && !pcgOnRingAtom && pcgKindToAddedCarbon(pcgKind) === null) {
    return nameMoleculeFusedRingAsSubstituent(graph, ringSys, groups, pcgKind, pcgGroups);
  }

  // ── Fused ring is parent ────────────────────────────────────────────────────

  // Collect ring atom sets for sub/PCG atoms
  const subRingAtoms = new Set<number>();
  const pcgRingAtoms = new Set<number>();

  if (pcgOnRingAtom) {
    for (const g of pcgGroups) if (ringAtoms.has(g.carbon)) pcgRingAtoms.add(g.carbon);
  }

  // For exocyclic PCG carbon: find the ring atom it's attached to
  const exocyclicPcgToRingAtom = new Map<number, number>();
  if (pcgOnExocyclicC) {
    for (const g of pcgGroups) {
      if (!ringAtoms.has(g.carbon) && isDirectlyAttachedToRing(graph, g.carbon, ringAtoms)) {
        for (const b of graph.bonds) {
          if (b.from === g.carbon && ringAtoms.has(b.to)) { exocyclicPcgToRingAtom.set(g.carbon, b.to); break; }
          if (b.to === g.carbon && ringAtoms.has(b.from)) { exocyclicPcgToRingAtom.set(g.carbon, b.from); break; }
        }
      }
    }
    for (const ringAtom of exocyclicPcgToRingAtom.values()) pcgRingAtoms.add(ringAtom);
  }

  // Substituent ring atoms (for all non-ring heavy neighbors of ring atoms)
  const subMap = ringSubstituents(graph, ringAtoms);
  for (const [ringAtom] of subMap) subRingAtoms.add(ringAtom);

  // Build exo carbon graph (non-ring carbons)
  const exoCarbonGraph = buildCarbonGraph(graph);
  for (const idx of ringAtoms) {
    exoCarbonGraph.carbons = exoCarbonGraph.carbons.filter(c => c !== idx);
    exoCarbonGraph.adj.delete(idx);
    for (const [, list] of exoCarbonGraph.adj) {
      const i = list.indexOf(idx);
      if (i >= 0) list.splice(i, 1);
    }
  }

  // Look up fused ring name with locant optimization
  const naming = nameFusedRing(graph, ringSys, {
    pcgAtoms: pcgRingAtoms.size > 0 ? pcgRingAtoms : undefined,
    subAtoms: subRingAtoms.size > 0 ? subRingAtoms : undefined,
  });
  if (!naming) {
    return { name: null, status: "unsupported", reason: "fused ring system not in curated table — Tier 4 (general fusion)" };
  }

  const { locantOf } = naming;
  const ringNameSubs: { locant: number; name: string }[] = [];

  const groupAtomSet = new Set<number>();
  for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);

  const exocyclicPcgCarbons = new Set(exocyclicPcgToRingAtom.keys());

  // Non-PCG groups on ring atoms
  const nonPcgGroups = pcgKind
    ? groups.filter(g => SENIORITY[g.kind] < SENIORITY[pcgKind] || SENIORITY[g.kind] === 0)
    : groups;

  const accountedAtoms = new Set<number>([...ringAtoms]);

  for (const g of nonPcgGroups) {
    if (ringAtoms.has(g.carbon)) {
      const loc = locantOf.get(g.carbon);
      if (loc !== undefined) {
        ringNameSubs.push({ locant: loc, name: prefixForm(g) });
        for (const a of g.atoms) accountedAtoms.add(a);
      }
    }
  }

  // Exocyclic PCG as added-carbon suffix
  let addedCarbon: { kind: import("./assemble").AddedCarbonSuffix; locants: number[] } | undefined;
  if (pcgOnExocyclicC && pcgGroups.length > 0) {
    const g = pcgGroups[0];
    const ringAtom = exocyclicPcgToRingAtom.get(g.carbon);
    if (ringAtom !== undefined) {
      const loc = locantOf.get(ringAtom);
      if (loc !== undefined) {
        const addedKind = pcgKindToAddedCarbon(pcgKind!);
        if (!addedKind) return { name: null, status: "unsupported", reason: `${pcgKind} not expressible as added-carbon on fused ring` };
        addedCarbon = { kind: addedKind, locants: [loc] };
        accountedAtoms.add(g.carbon);
        for (const a of g.atoms) accountedAtoms.add(a);
      }
    }
  }

  // PCG directly on ring atom → suffix
  let suffix: import("./assemble").SuffixSpec | undefined;
  if (pcgOnRingAtom && pcgGroups.length > 0) {
    const pcgLocs = pcgGroups
      .filter(g => ringAtoms.has(g.carbon))
      .map(g => locantOf.get(g.carbon)!)
      .filter(l => l !== undefined)
      .sort((a, b) => a - b);
    if (pcgLocs.length > 0) {
      suffix = { kind: toSuffixKindRing(pcgKind!), locants: pcgLocs };
      for (const g of pcgGroups) {
        if (ringAtoms.has(g.carbon)) for (const a of g.atoms) accountedAtoms.add(a);
      }
    }
  }

  // Halogens and alkyl substituents on ring atoms
  for (const [ringAtom, exoNbrs] of subMap) {
    for (const exoNbr of exoNbrs) {
      if (groupAtomSet.has(exoNbr)) continue;
      if (exocyclicPcgCarbons.has(exoNbr)) continue;
      if (groups.some(g => g.carbon === exoNbr)) continue;

      const loc = locantOf.get(ringAtom);
      if (loc === undefined) continue;

      const atom = graph.atoms.find(a => a.index === exoNbr);
      if (!atom) continue;

      if (["F", "Cl", "Br", "I"].includes(atom.element)) {
        const halPfx: Record<string, string> = { F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo" };
        ringNameSubs.push({ locant: loc, name: halPfx[atom.element] });
        accountedAtoms.add(exoNbr);
        continue;
      }

      if (atom.element === "C") {
        const subName = nameSubstituent(exoCarbonGraph, exoNbr, ringAtom);
        ringNameSubs.push({ locant: loc, name: subName });
        const subAtoms = collectSubtreeAtoms(exoCarbonGraph, exoNbr, ringAtom);
        for (const a of subAtoms) accountedAtoms.add(a);
        continue;
      }

      return { name: null, status: "unsupported", reason: "substituent on fused ring not yet supported" };
    }
  }

  // Completeness guard
  if (heavy.some(a => !accountedAtoms.has(a.index))) {
    return { name: null, status: "unsupported", reason: "fused ring: unaccounted atoms — substituent not yet supported" };
  }

  const finalName = assembleRingName({
    parent: naming.parent,
    subs: ringNameSubs,
    suffix,
    addedCarbon,
  });

  return { name: finalName, status: "named" };
}

/**
 * Fused ring as substituent on a chain (Task 3).
 * e.g. OC(=O)Cc1ccc2ccccc2c1 → 2-(naphthalen-2-yl)acetic acid
 */
function nameMoleculeFusedRingAsSubstituent(
  graph: MolGraph,
  ringSys: import("./ring").RingSystemInfo,
  groups: import("./functionalGroups").Group[],
  pcgKind: import("./functionalGroups").GroupKind,
  pcgGroups: import("./functionalGroups").Group[],
): NameResult {
  const heavy = graph.atoms.filter(a => a.element !== "H");
  const ringAtoms = ringSys.atoms;

  // Look up the fused ring name (no PCG/sub hints since the ring is a substituent)
  const naming = nameFusedRing(graph, ringSys, {});
  if (!naming) {
    return { name: null, status: "unsupported", reason: "fused ring system not in curated table — cannot use as substituent" };
  }

  // Find the ring-to-chain attachment bond
  let ringAttachAtom: number | null = null;
  let chainAttachAtom: number | null = null;
  for (const b of graph.bonds) {
    const fromInRing = ringAtoms.has(b.from);
    const toInRing = ringAtoms.has(b.to);
    if (fromInRing && !toInRing && graph.atoms.find(a => a.index === b.to)?.element === "C") {
      ringAttachAtom = b.from; chainAttachAtom = b.to; break;
    }
    if (toInRing && !fromInRing && graph.atoms.find(a => a.index === b.from)?.element === "C") {
      ringAttachAtom = b.to; chainAttachAtom = b.from; break;
    }
  }

  if (ringAttachAtom === null || chainAttachAtom === null) {
    return { name: null, status: "unsupported", reason: "fused ring not attached to chain via carbon" };
  }

  // Verify single ring-chain attachment
  const ringChainBonds = graph.bonds.filter(b => {
    const fromInRing = ringAtoms.has(b.from);
    const toInRing = ringAtoms.has(b.to);
    if ((fromInRing && !toInRing) || (!fromInRing && toInRing)) {
      const exoAtom = fromInRing ? b.to : b.from;
      return graph.atoms.find(a => a.index === exoAtom)?.element !== "H";
    }
    return false;
  });
  if (ringChainBonds.length > 1) {
    return { name: null, status: "unsupported", reason: "multiple fused-ring to chain attachments — not supported" };
  }

  // Build fused ring substituent name: "naphthalen-2-yl"
  const attachLocant = naming.locantOf.get(ringAttachAtom) ?? 1;
  const parentBase = naming.parent; // e.g. "naphthalene"
  // Drop trailing 'e' if present, add '-locant-yl'
  const base = parentBase.endsWith("e") ? parentBase.slice(0, -1) : parentBase;
  const ringSub = `${base}-${attachLocant}-yl`;

  // Build chain carbon graph (no ring carbons)
  const cg = buildCarbonGraph(graph);
  for (const idx of ringAtoms) {
    cg.carbons = cg.carbons.filter(c => c !== idx);
    cg.adj.delete(idx);
    for (const [, list] of cg.adj) {
      const i = list.indexOf(idx);
      if (i >= 0) list.splice(i, 1);
    }
  }

  const CARBON_PREFIX = new Set<import("./functionalGroups").GroupKind>(["nitrile", "acid", "amide"]);
  const excludedCarbons = new Set<number>();
  if (pcgKind) {
    for (const g of groups) {
      if (g.kind !== pcgKind && CARBON_PREFIX.has(g.kind)) excludedCarbons.add(g.carbon);
    }
  }
  if (excludedCarbons.size > 0) {
    cg.carbons = cg.carbons.filter(c => !excludedCarbons.has(c));
    for (const c of excludedCarbons) cg.adj.delete(c);
    for (const [, list] of cg.adj) {
      for (let i = list.length - 1; i >= 0; i--) if (excludedCarbons.has(list[i])) list.splice(i, 1);
    }
  }

  const pcgCarbons = pcgGroups.map(g => g.carbon).filter(c => !ringAtoms.has(c));
  const chain = selectPrincipalChain(cg, { pcgCarbons }).atoms;
  const inChain = new Set(chain);

  const chainPos = chain.indexOf(chainAttachAtom);
  if (chainPos < 0) {
    return { name: null, status: "unsupported", reason: "fused ring attachment carbon not on principal chain — not yet supported" };
  }

  // ene/yne on chain
  const doubles: number[] = [];
  const triples: number[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const o = ccOrder(cg, chain[i], chain[i + 1]);
    if (o === 2) doubles.push(i + 1);
    if (o === 3) triples.push(i + 1);
  }

  const groupAtomSet = new Set<number>();
  for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);

  const subs: { locant: number; name: string }[] = [];
  const nonPcgGroups = pcgKind
    ? groups.filter(g => SENIORITY[g.kind] < SENIORITY[pcgKind] || SENIORITY[g.kind] === 0)
    : groups;

  for (const g of nonPcgGroups) {
    const anchor = CARBON_PREFIX.has(g.kind)
      ? neighborsOf(graph, g.carbon).find(n => inChain.has(n))
      : (inChain.has(g.carbon) ? g.carbon : undefined);
    if (anchor === undefined) continue;
    subs.push({ locant: chain.indexOf(anchor) + 1, name: prefixForm(g) });
  }

  // Alkyl branches
  for (let i = 0; i < chain.length; i++) {
    for (const nb of cg.adj.get(chain[i]) ?? []) {
      if (!inChain.has(nb) && !groupAtomSet.has(nb)) {
        subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, chain[i]) });
      }
    }
  }

  // Add fused ring as substituent
  subs.push({ locant: chainPos + 1, name: ringSub });

  // Completeness guard
  const accounted = new Set<number>([...chain, ...ringAtoms]);
  for (const g of groups) {
    if (inChain.has(g.carbon)) for (const a of g.atoms) accounted.add(a);
  }
  for (const c of chain) {
    for (const nb of cg.adj.get(c) ?? []) {
      if (!inChain.has(nb) && !groupAtomSet.has(nb)) {
        for (const a of branchCarbons(cg, nb, inChain)) accounted.add(a);
      }
    }
  }
  if (heavy.some(a => !accounted.has(a.index))) {
    return { name: null, status: "unsupported", reason: "fused ring: chain/substituent not fully accounted — not yet supported" };
  }

  // Suffix
  let suffix: import("./assemble").SuffixSpec | undefined;
  if (pcgKind && pcgGroups.length > 0) {
    const suffixLocants = pcgGroups
      .map(g => chain.indexOf(g.carbon) + 1)
      .filter(l => l > 0)
      .sort((a, b) => a - b);
    suffix = { kind: toSuffixKind(pcgKind), locants: suffixLocants };
  }

  const nameTxt = assembleName({ chainLen: chain.length, doubles, triples, subs, suffix });
  return { name: nameTxt, status: "named" };
}

/**
 * Name a single-ring molecule. Called by nameMolecule when hasRing() is true.
 */
function nameMoleculeRing(graph: MolGraph): NameResult {
  const heavy = graph.atoms.filter((a) => a.element !== "H");

  // ── Stage 0: perceive and classify ring system ────────────────────────────
  const ringSys = perceiveRingSystem(graph);

  if (ringSys.kind === "fused") {
    // Route to Tier 4 Stage 2 fused ring handler
    return nameFusedRingSystem(graph, ringSys);
  }
  if (ringSys.kind === "spiro") {
    return { name: null, status: "unsupported", reason: "spiro ring system — Tier 4 (Stage 4)" };
  }
  if (ringSys.kind === "bridged") {
    return { name: null, status: "unsupported", reason: "bridged ring system — Tier 4 (Stage 3, von Baeyer)" };
  }
  if (ringSys.kind === "assembly") {
    return { name: null, status: "unsupported", reason: "ring assembly (disjoint rings) — Tier 4 (Stage 4)" };
  }
  if (ringSys.kind === "other") {
    return { name: null, status: "unsupported", reason: "complex polycyclic ring system — Tier 4" };
  }

  // mono → use existing single-ring path
  // Perceive the ring
  const ring = perceiveRing(graph);
  if (!ring) {
    // ≥2 rings (naphthalene, decalin, etc.) → Tier 4
    return { name: null, status: "unsupported", reason: "fused/bridged/multiple rings — Tier 4" };
  }

  const ringSet = new Set(ring.atoms);

  // ── CLASS 3 (NO WRONG NAMES): hypervalent/charged ring heteroatom ───────────
  // A substituent on an aromatic ring heteroatom can imply a hypervalent or
  // charged species that RDKit canonicalises differently (e.g. CCN1C=CS(CC)=C1
  // has a hypervalent [SH]-type S). Naming such a structure as a normal thiazole
  // drops/misrepresents the substituent.
  //   - aromatic O or S bearing ANY exocyclic substituent → hypervalent → decline
  //   - aromatic "pyridine-type" N (an in-ring double bond) bearing a substituent
  //     → charged (pyridinium) → decline
  //   - aromatic "pyrrole-type" N (both ring bonds single) legitimately bears ONE
  //     substituent (1-methylpyrrole, 1-methylimidazole); a SECOND one would
  //     charge it → decline.
  if (ring.aromatic) {
    for (const hetIdx of ring.heteroatoms) {
      const het = graph.atoms.find((a) => a.index === hetIdx);
      if (!het) continue;
      // Exocyclic non-H, non-ring neighbours = substituents on this heteroatom.
      const exoSubs = neighborsOf(graph, hetIdx).filter(
        (n) => !ringSet.has(n) && graph.atoms.find((a) => a.index === n)?.element !== "H",
      );
      if (exoSubs.length === 0) continue;
      if (het.element === "O" || het.element === "S") {
        return {
          name: null,
          status: "unsupported",
          reason: "substituent on aromatic ring O/S implies a hypervalent species — Tier 4",
        };
      }
      if (het.element === "N") {
        const hasRingDoubleBond = graph.bonds.some(
          (b) => b.order === 2 && ((b.from === hetIdx && ringSet.has(b.to)) || (b.to === hetIdx && ringSet.has(b.from))),
        );
        // Pyridine-type N (in-ring double bond) with a substituent → pyridinium.
        // Pyrrole-type N with more than one substituent → charged.
        if (hasRingDoubleBond || exoSubs.length > 1) {
          return {
            name: null,
            status: "unsupported",
            reason: "substituent on aromatic ring N implies a charged species — Tier 4",
          };
        }
      }
    }
  }

  // Perceive functional groups (same as acyclic path)
  const perception = perceiveGroups(graph);
  if (perception.unsupported) {
    return { name: null, status: "unsupported", reason: perception.unsupported };
  }

  // Filter out any groups whose heteroatom atoms are part of the ring itself.
  // Ring heteroatoms (N in piperidine, O in furan, etc.) are named as part of
  // the ring name — they must NOT be treated as functional group substituents.
  // A group is ring-internal if ALL its 'atoms' (heteroatom indices) are in the ring.
  const allGroups = perception.groups.filter(g => {
    // If all group heteroatoms are ring atoms, skip this group
    const allInRing = g.atoms.every(a => ringSet.has(a));
    return !allInRing;
  });

  // Also filter: if the group's carbon is a ring atom AND the group's heteroatom
  // is a ring atom (e.g. ring O classified as ether) → skip
  const groups = allGroups.filter(g => {
    // Ether: O between two ring carbons → ring itself; skip
    if (g.kind === "ether" && ringSet.has(g.carbon) && ringSet.has(g.atoms[0])) return false;
    return true;
  });

  // ── Cyclic carbonyl (Tier 4 Stage 1): lactams / lactones / aromatic ring-carbonyls ──
  // A ring carbonyl: group's carbon is in the ring AND at least one heteroatom in g.atoms
  // is also in the ring (N for lactam, O for lactone; also =O in aromatic ring-carbonyl).
  {
    const cyclicCarbonylGroups = groups.filter(
      g => ringSet.has(g.carbon) && g.atoms.some(a => ringSet.has(a))
    );

    // Also detect "mancude ring-carbonyl": ring has ring double bonds AND a ring C has
    // an exo =O (perceived as ketone because the in-ring N was filtered out of groups).
    // This prevents wrong names like "piperidin-4-one" for pyridinone.
    const ringDoubleBondsExist = graph.bonds.some(
      b => b.order === 2 && ringSet.has(b.from) && ringSet.has(b.to)
    );
    const hasRingCarbonylKetone = ringDoubleBondsExist && groups.some(
      g => (g.kind === "ketone" || g.kind === "aldehyde") && ringSet.has(g.carbon)
    );
    const hasMancudeCarbonyl = hasRingCarbonylKetone && ring.heteroatoms.length > 0;

    if (cyclicCarbonylGroups.length > 0 || hasMancudeCarbonyl) {
      // Route to Tier 4 Stage 1 handler
      const t4Result = nameCyclicCarbonyl(graph, ring, ringSet, groups, cyclicCarbonylGroups);
      if (t4Result !== null) return t4Result;
      // If handler returns null → fall through to the old decline below
      return {
        name: null,
        status: "unsupported",
        reason: `ring carbonyl with heteroatom in ring (lactam/lactone/pyridinone) — Tier 4`,
      };
    }
  }

  // ── Aromatic N-heterocycle + ring OH = pyridinol/pyridinone tautomer → Tier 4 ─
  // When an aromatic ring has N in the ring AND an alcohol group directly on a ring
  // carbon, the dominant tautomer is the pyridinone (carbonyl form), not the enol
  // (hydroxyl form). e.g. Oc1ccccn1 is 1H-pyridin-2-one, not pyridin-2-ol.
  // We must NOT name this as pyridin-2-ol (which refers to a minor tautomer).
  if (ring.aromatic && ring.heteroatoms.length > 0) {
    const atomById = new Map(graph.atoms.map(a => [a.index, a]));
    const hasNInRing = ring.heteroatoms.some(idx => atomById.get(idx)?.element === "N");
    if (hasNInRing) {
      // Check if any alcohol group has its carbon in the ring
      const alcoholOnRing = groups.some(g => g.kind === "alcohol" && ringSet.has(g.carbon));
      if (alcoholOnRing) {
        return {
          name: null,
          status: "unsupported",
          reason: `aromatic N-heterocycle with ring OH is a tautomeric pyridinone — Tier 4`,
        };
      }
    }
  }

  // Check that every heteroatom is accounted for
  {
    const groupAtomSet = new Set<number>();
    for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);
    for (const a of graph.atoms) {
      if (a.element === "C" || a.element === "H") continue;
      // Ring heteroatoms (N, O, S in the ring) are accounted for as ring members
      if (ringSet.has(a.index)) continue;
      if (!groupAtomSet.has(a.index)) {
        const eName = { O: "oxygen", N: "nitrogen", S: "sulfur", F: "fluorine", Cl: "chlorine", Br: "bromine", I: "iodine" }[a.element] ?? a.element;
        return { name: null, status: "unsupported", reason: `contains unclassified ${eName} — functional group not recognized in this tier` };
      }
    }
  }

  // Determine PCG
  const pcgKind = principalKind(groups);

  // ── CLASS 2 (NO WRONG NAMES): acid derivative as a non-principal prefix ─────
  // Same rule as the acyclic path: acylHalide/ester/anhydride have no valid
  // detachable-prefix form, so decline when present but not the PCG.
  if (groups.some((g) => isTwoPart(g.kind) && g.kind !== pcgKind)) {
    return {
      name: null,
      status: "unsupported",
      reason: "acid derivative as substituent prefix not yet supported — Tier 4",
    };
  }

  // ── Determine parent: ring or chain ──────────────────────────────────────────
  // Rule:
  //  1. No PCG → ring is parent (e.g. alkylcyclohexane)
  //  2. PCG on a ring atom → ring is parent (cyclohexanol, cyclohexanone)
  //  3. PCG on a directly-attached exocyclic carbon → ring parent + added-carbon suffix
  //     (cyclohexanecarboxylic acid, benzoic acid)
  //  4. PCG on a chain not at the ring → chain is parent, ring becomes substituent
  //     (2-phenylacetic acid)

  const pcgGroups = pcgKind ? groups.filter(g => g.kind === pcgKind) : [];

  // Check where each PCG sits relative to the ring
  let pcgOnRingAtom = false;
  let pcgOnExocyclicC = false; // group carbon is exocyclic, directly attached to ring
  let pcgOnChain = false;

  for (const g of pcgGroups) {
    if (ringSet.has(g.carbon)) {
      pcgOnRingAtom = true;
    } else if (isDirectlyAttachedToRing(graph, g.carbon, ringSet)) {
      // PCG carbon is exocyclic and directly bonded to a ring atom → added-carbon form
      pcgOnExocyclicC = true;
    } else {
      pcgOnChain = true;
    }
  }

  // If PCG only on chain (not ring-adjacent) → chain parent
  if (pcgKind && pcgOnChain && !pcgOnRingAtom && !pcgOnExocyclicC) {
    return nameMoleculeRingAsSubstituent(graph, ring, groups, pcgKind, pcgGroups);
  }

  // If PCG is on an exocyclic carbon that cannot be expressed as an added-carbon suffix
  // (acid/nitrile/aldehyde/amide can; alcohol/ketone/amine/etc. cannot), then the
  // exocyclic carbon+group forms a chain parent and the ring is the substituent.
  // e.g. OCC1CCCCC1 → cyclohexylmethanol (chain=CH2OH, ring sub=cyclohexyl)
  //      OCc1ccccc1 → phenylmethanol (chain=CH2OH, ring sub=phenyl)
  if (pcgKind && pcgOnExocyclicC && !pcgOnRingAtom && pcgKindToAddedCarbon(pcgKind) === null) {
    return nameMoleculeRingAsSubstituent(graph, ring, groups, pcgKind, pcgGroups);
  }

  // For two-part naming (acylHalide/ester/anhydride) on a ring — complex, defer
  if (pcgKind && (pcgKind === "acylHalide" || pcgKind === "ester" || pcgKind === "anhydride")) {
    return { name: null, status: "unsupported", reason: "acyl halide/ester/anhydride on ring — not yet supported in this tier" };
  }

  // ── Ring is parent ──────────────────────────────────────────────────────────

  // Identify ring substituents (non-ring non-H atoms attached to ring atoms)
  const subMap = ringSubstituents(graph, ringSet);

  // Build the CarbonGraph for the exocyclic (non-ring) carbons only
  // (substituent naming uses the C-graph of the chains hanging off the ring)
  const exoCarbonGraph = buildCarbonGraph(graph);
  // Remove ring carbons from the carbon graph so substituent naming doesn't
  // traverse through the ring
  for (const idx of ringSet) {
    exoCarbonGraph.carbons = exoCarbonGraph.carbons.filter(c => c !== idx);
    exoCarbonGraph.adj.delete(idx);
    for (const [, list] of exoCarbonGraph.adj) {
      const i = list.indexOf(idx);
      if (i >= 0) list.splice(i, 1);
    }
  }

  // Classify each ring-attached substituent:
  //  - FG group atoms hanging off the ring → suffix or prefix
  //  - alkyl/halogen chains → prefix substituents
  //  - PCG exocyclic carbon → added-carbon suffix
  const groupAtomSet = new Set<number>();
  for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);

  // Set of "group carbon" indices that are the exocyclic PCG carbon
  const exocyclicPcgCarbons = new Set<number>();
  if (pcgOnExocyclicC) {
    for (const g of pcgGroups) {
      if (!ringSet.has(g.carbon) && isDirectlyAttachedToRing(graph, g.carbon, ringSet)) {
        exocyclicPcgCarbons.add(g.carbon);
      }
    }
  }

  // For each exocyclic PCG carbon, find the ring atom it's attached to
  const exocyclicPcgToRingAtom = new Map<number, number>();
  for (const excC of exocyclicPcgCarbons) {
    for (const b of graph.bonds) {
      if (b.from === excC && ringSet.has(b.to)) { exocyclicPcgToRingAtom.set(excC, b.to); break; }
      if (b.to === excC && ringSet.has(b.from)) { exocyclicPcgToRingAtom.set(excC, b.from); break; }
    }
  }

  // Collect ring atoms that carry substituents (for locant optimization)
  // A ring atom has a substituent if it has non-ring non-H neighbors not accounted for by groups
  // that have their carbon IN the ring, or by exocyclic PCG carbons.
  const subRingAtoms = new Set<number>(); // ring atoms with any substituent (for numbering)
  const pcgRingAtoms = new Set<number>(); // ring atoms that are the PCG or bear exo-PCG carbon

  // For PCG on ring atom directly:
  if (pcgOnRingAtom) {
    for (const g of pcgGroups) {
      if (ringSet.has(g.carbon)) pcgRingAtoms.add(g.carbon);
    }
  }
  // For PCG on exocyclic carbon:
  if (pcgOnExocyclicC) {
    for (const [excC, ringAtom] of exocyclicPcgToRingAtom) {
      void excC;
      pcgRingAtoms.add(ringAtom);
    }
  }

  // Any ring atom with a substituent (prefix sub or PCG)
  for (const [ringAtom] of subMap) {
    subRingAtoms.add(ringAtom);
  }

  // Get ring naming with locant optimization
  const unsatBonds: [number, number][] = [];
  if (!ring.aromatic) {
    // Find double bonds in the ring
    for (const b of graph.bonds) {
      if (b.order === 2 && ringSet.has(b.from) && ringSet.has(b.to)) {
        unsatBonds.push([b.from, b.to]);
      }
    }
  }

  // Precompute substituent alpha keys for the alphabetical locant tie-break.
  // We do a preliminary pass over all substituents to get (ringAtom → alphaKey)
  // before calling nameRing, so the tie-break can be applied during locant assignment.
  const subAlphaKeys = new Map<number, string>();
  {
    const halPfx: Record<string, string> = { F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo" };
    // Strip leading digits/hyphens to get the alpha key (same as assemble.ts alphaKey)
    const alphaKey = (n: string) => n.replace(/^\((.*)\)$/, "$1").replace(/^[\d,()\-\s]+/, "");

    // Non-PCG groups directly on ring atoms contribute their prefix form
    for (const g of groups) {
      if (g.kind === pcgKind) continue; // PCG is handled by pcgAtoms, not alpha key
      if (ringSet.has(g.carbon) && !subAlphaKeys.has(g.carbon)) {
        subAlphaKeys.set(g.carbon, alphaKey(prefixForm(g)));
      }
    }

    // Halogen and alkyl substituents from subMap
    for (const [ringAtom, exoNbrs] of subMap) {
      for (const exoNbr of exoNbrs) {
        if (exocyclicPcgCarbons.has(exoNbr)) continue;
        if (groups.some(g => g.atoms.includes(exoNbr) || g.carbon === exoNbr)) continue;

        const atom = graph.atoms.find(a => a.index === exoNbr);
        if (!atom) continue;

        let subName: string | undefined;
        if (["F", "Cl", "Br", "I"].includes(atom.element)) {
          subName = halPfx[atom.element];
        } else if (atom.element === "C") {
          subName = nameSubstituent(exoCarbonGraph, exoNbr, ringAtom);
        }
        if (subName !== undefined && !subAlphaKeys.has(ringAtom)) {
          subAlphaKeys.set(ringAtom, alphaKey(subName));
        }
      }
    }
  }

  const ringNaming = nameRing(graph, ring, {
    pcgAtoms: pcgRingAtoms.size > 0 ? pcgRingAtoms : undefined,
    unsatBonds,
    subAtoms: subRingAtoms.size > 0 ? subRingAtoms : undefined,
    subAlphaKeys: subAlphaKeys.size > 0 ? subAlphaKeys : undefined,
  });

  if (!ringNaming) {
    return { name: null, status: "unsupported", reason: "ring not yet supported — Tier 4" };
  }

  const { locantOf } = ringNaming;

  // ── Special retained aromatics: styrene ──────────────────────────────────────
  // Styrene = benzene + exactly one vinyl (CH=CH2) substituent, no other groups.
  if (ringNaming.kind === "benzene" && !pcgKind && groups.length === 0) {
    const styreneName = detectStyrene(graph, ringSet);
    if (styreneName) return { name: styreneName, status: "named" };
  }

  // ── Build substituent list ──────────────────────────────────────────────────
  const ringNameSubs: { locant: number; name: string }[] = [];

  // Non-PCG groups attached to ring atoms (prefix form)
  const nonPcgGroups = pcgKind
    ? groups.filter(g => SENIORITY[g.kind] < SENIORITY[pcgKind] || SENIORITY[g.kind] === 0)
    : groups;

  // Track which group atoms are accounted for
  const accountedAtoms = new Set<number>(ring.atoms);

  // Process non-PCG groups attached to ring atoms
  for (const g of nonPcgGroups) {
    if (ringSet.has(g.carbon)) {
      // Group directly on ring atom
      const loc = locantOf.get(g.carbon);
      if (loc !== undefined) {
        ringNameSubs.push({ locant: loc, name: prefixForm(g) });
        for (const a of g.atoms) accountedAtoms.add(a);
      }
    } else if (isDirectlyAttachedToRing(graph, g.carbon, ringSet)) {
      // Group on exocyclic carbon attached to ring — treat as substituent
      // The ring atom bearing this exocyclic group
      const ringAtom = [...ringSet].find(idx => graph.bonds.some(b =>
        (b.from === idx && b.to === g.carbon) || (b.to === idx && b.from === g.carbon)
      ));
      if (ringAtom !== undefined) {
        const loc = locantOf.get(ringAtom);
        if (loc !== undefined) {
          // This exocyclic group carbon is NOT the PCG carbon
          // We need to express it as a prefix including its own carbon
          // e.g. carboxy, cyano, carbamoyl
          const CARBON_PREFIX = new Set<GroupKind>(["nitrile", "acid", "amide"]);
          if (CARBON_PREFIX.has(g.kind)) {
            ringNameSubs.push({ locant: loc, name: prefixForm(g) });
            accountedAtoms.add(g.carbon);
            for (const a of g.atoms) accountedAtoms.add(a);
          }
        }
      }
    }
  }

  // Process exocyclic PCG carbon as added-carbon suffix (for ring-parent path)
  let addedCarbon: { kind: import("./assemble").AddedCarbonSuffix; locants: number[] } | undefined;
  if (pcgOnExocyclicC && pcgGroups.length > 0) {
    const g = pcgGroups[0]; // single exocyclic PCG
    const ringAtom = exocyclicPcgToRingAtom.get(g.carbon);
    if (ringAtom !== undefined) {
      const loc = locantOf.get(ringAtom);
      if (loc !== undefined) {
        const addedKind = pcgKindToAddedCarbon(pcgKind!);
        if (!addedKind) {
          return { name: null, status: "unsupported", reason: `${pcgKind} not expressible as added-carbon on ring` };
        }
        addedCarbon = { kind: addedKind, locants: [loc] };
        accountedAtoms.add(g.carbon);
        for (const a of g.atoms) accountedAtoms.add(a);
      }
    }
  }

  // PCG directly on ring atom → suffix
  let suffix: import("./assemble").SuffixSpec | undefined;
  if (pcgOnRingAtom && pcgGroups.length > 0) {
    const pcgLocs = pcgGroups
      .filter(g => ringSet.has(g.carbon))
      .map(g => locantOf.get(g.carbon)!)
      .filter(l => l !== undefined)
      .sort((a, b) => a - b);
    if (pcgLocs.length > 0) {
      suffix = { kind: toSuffixKindRing(pcgKind!), locants: pcgLocs };
      for (const g of pcgGroups) {
        if (ringSet.has(g.carbon)) {
          for (const a of g.atoms) accountedAtoms.add(a);
        }
      }
    }
  }

  // Process alkyl/halogen substituents on ring atoms
  for (const [ringAtom, exoNbrs] of subMap) {
    for (const exoNbr of exoNbrs) {
      // Skip if already accounted for by a group
      if (groupAtomSet.has(exoNbr)) continue;
      if (exocyclicPcgCarbons.has(exoNbr)) continue;
      // Skip if this is a non-PCG group carbon (e.g. a non-PCG acid/nitrile/amide)
      if (groups.some(g => g.carbon === exoNbr)) continue;

      const loc = locantOf.get(ringAtom);
      if (loc === undefined) continue;

      // Name the substituent (alkyl chain or similar)
      const atom = graph.atoms.find(a => a.index === exoNbr);
      if (!atom) continue;

      // Halogens: direct prefix
      if (["F", "Cl", "Br", "I"].includes(atom.element)) {
        const halPfx: Record<string, string> = { F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo" };
        ringNameSubs.push({ locant: loc, name: halPfx[atom.element] });
        accountedAtoms.add(exoNbr);
        continue;
      }

      // Carbon: name as alkyl substituent using the exo carbon graph
      if (atom.element === "C") {
        const subName = nameSubstituent(exoCarbonGraph, exoNbr, ringAtom);
        ringNameSubs.push({ locant: loc, name: subName });
        // Account for all carbons in this substituent
        const subAtoms = collectSubtreeAtoms(exoCarbonGraph, exoNbr, ringAtom);
        for (const a of subAtoms) accountedAtoms.add(a);
        continue;
      }

      // Other (unsupported substituent type on ring)
      return { name: null, status: "unsupported", reason: "contains a substituent not yet supported on rings in this tier" };
    }
  }

  // Also account for PCG group atoms on exocyclic non-direct cases
  if (pcgKind) {
    for (const g of pcgGroups) {
      if (!ringSet.has(g.carbon) && !exocyclicPcgCarbons.has(g.carbon)) {
        // PCG on a more distal chain — was already routed to chain-parent path
        // This shouldn't happen here, but let's be safe
      }
    }
  }

  // Completeness guard: every heavy atom must be accounted for
  if (heavy.some(a => !accountedAtoms.has(a.index))) {
    return { name: null, status: "unsupported", reason: "contains a substituent or arrangement not yet supported in this tier" };
  }

  // Multiple-bond guard for ring path:
  // Each double/triple bond must be:
  //  (a) a ring bond (accounted by ring aromaticity / cycloalkene detection)
  //  (b) a group bond (C=O carbonyl, C≡N nitrile)
  //  (c) a chain ene/yne on an exocyclic substituent (for styrene: C=C exo)
  for (const b of graph.bonds) {
    if (b.order < 2) continue;
    // Ring bonds are OK (ring handles them)
    if (ringSet.has(b.from) && ringSet.has(b.to)) continue;
    // Group bonds (carbonyl, nitrile)
    if (groups.some(g => g.atoms.includes(b.from) || g.atoms.includes(b.to))) continue;
    // Exocyclic group bonds for exocyclic PCG (C=O for aldehyde, etc.)
    if (pcgGroups.some(g => g.carbon === b.from || g.carbon === b.to)) continue;
    // Exo double bond from ring to substituent (e.g. styrene C=C)
    // Allow if both atoms are in accountedAtoms
    if (accountedAtoms.has(b.from) && accountedAtoms.has(b.to)) continue;
    return { name: null, status: "unsupported", reason: "contains a multiple bond not expressible in this tier" };
  }

  // ── Retained aromatic names ─────────────────────────────────────────────────
  let retainedAromatic: string | undefined;
  if (ringNaming.kind === "benzene") {
    retainedAromatic = detectRetainedAromatic(ringNaming.parent, pcgKind, pcgGroups, groups, ringNameSubs, addedCarbon, ringSet);
  }

  // ── Ring double bond locants (for cycloalkenes) ───────────────────────────
  let ringDoubleBondLocants: number[] | undefined;
  if (!ring.aromatic && unsatBonds.length > 0) {
    const ringSize = ring.size;
    ringDoubleBondLocants = unsatBonds.map(([a, b]) => {
      const la = locantOf.get(a)!;
      const lb = locantOf.get(b)!;
      const lo = Math.min(la, lb);
      const hi = Math.max(la, lb);
      // Wrap-around bond {1, n}: cite at locant n (the ring-closure position).
      return lo === 1 && hi === ringSize ? ringSize : lo;
    }).sort((a, b) => a - b);
  }

  // Assemble the name
  const finalName = assembleRingName({
    parent: ringNaming.parent,
    subs: ringNameSubs,
    ringDoubleBondLocants,
    suffix,
    addedCarbon,
    retainedAromatic,
  });

  return { name: finalName, status: "named" };
}

/** Map PCG kind to the added-carbon suffix kind for exocyclic groups. */
function pcgKindToAddedCarbon(pcgKind: GroupKind): import("./assemble").AddedCarbonSuffix | null {
  if (pcgKind === "acid") return "carboxylic acid";
  if (pcgKind === "nitrile") return "carbonitrile";
  if (pcgKind === "aldehyde") return "carbaldehyde";
  if (pcgKind === "amide") return "carboxamide" as import("./assemble").AddedCarbonSuffix;
  return null;
}

/** Suffix kind for on-ring PCG groups. */
function toSuffixKindRing(k: GroupKind): SuffixKind {
  const map: Partial<Record<GroupKind, SuffixKind>> = {
    ketone: "one",
    alcohol: "ol",
    amine: "amine",
    amide: "amide",
    nitrile: "nitrile",
    aldehyde: "al",
    acid: "oic acid",
  };
  return map[k]!;
}

/**
 * Detect a retained aromatic name for benzene + defining group.
 * Returns the retained name (e.g. "phenol", "aniline") or undefined.
 *
 * Retained names that apply:
 *  phenol    = benzene + alcohol (OH on ring)
 *  aniline   = benzene + amine (NH2 on ring)
 *  toluene   = benzene + single methyl substituent (no FG)
 *  styrene   = benzene + single vinyl (ethenyl) substituent
 *  benzamide = benzene + amide on ring
 *  benzoic acid, benzaldehyde, benzonitrile = handled by benzene + added-carbon
 */
function detectRetainedAromatic(
  _parentName: string,
  pcgKind: GroupKind | null,
  pcgGroups: Group[],
  allGroups: Group[],
  subs: { locant: number; name: string }[],
  addedCarbon: { kind: import("./assemble").AddedCarbonSuffix; locants: number[] } | undefined,
  ringSet: Set<number>,
): string | undefined {
  // If there's an added-carbon suffix, benzene → benzoic acid / benzaldehyde / benzonitrile
  // (these are already handled in assembleRingName; return undefined here to let assemble handle it)
  if (addedCarbon) return undefined;

  // Suffix-path retained names: phenol (alcohol on ring), aniline (amine on ring)
  if (pcgKind === "alcohol" && pcgGroups.length === 1 && ringSet.has(pcgGroups[0].carbon)) {
    return "phenol";
  }
  if (pcgKind === "amine" && pcgGroups.length === 1 && ringSet.has(pcgGroups[0].carbon)) {
    return "aniline";
  }
  if (pcgKind === "amide" && pcgGroups.length === 1 && ringSet.has(pcgGroups[0].carbon)) {
    return "benzamide";
  }

  // Toluene: no PCG, exactly one substituent which is "methyl"
  if (!pcgKind && allGroups.length === 0 && subs.length === 1 && subs[0].name === "methyl") {
    return "toluene";
  }

  // Styrene: no PCG, exactly one substituent which is "ethenyl" (vinyl, CH=CH2)
  if (!pcgKind && allGroups.length === 0 && subs.length === 1 && subs[0].name === "ethenyl") {
    return "styrene";
  }

  return undefined;
}

/**
 * If the ring is benzene and has exactly one exocyclic vinyl group (CH=CH2) and
 * no other substituents or groups, return "styrene". Otherwise return null.
 */
function detectStyrene(graph: MolGraph, ringSet: Set<number>): string | null {
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));

  // Collect exocyclic non-H atoms attached to ring atoms
  const exoAtoms: { ringAtom: number; exo: number }[] = [];
  for (const b of graph.bonds) {
    if (ringSet.has(b.from) && !ringSet.has(b.to)) {
      const exoAtom = atomById.get(b.to);
      if (exoAtom && exoAtom.element !== "H") exoAtoms.push({ ringAtom: b.from, exo: b.to });
    } else if (ringSet.has(b.to) && !ringSet.has(b.from)) {
      const exoAtom = atomById.get(b.from);
      if (exoAtom && exoAtom.element !== "H") exoAtoms.push({ ringAtom: b.to, exo: b.from });
    }
  }

  if (exoAtoms.length !== 1) return null;
  const { exo: vinylC1 } = exoAtoms[0];

  // vinylC1 must be carbon
  const c1 = atomById.get(vinylC1);
  if (!c1 || c1.element !== "C") return null;

  // vinylC1 must have a double bond to vinylC2 (=CH2)
  const vinylBond = graph.bonds.find(b =>
    b.order === 2 && ((b.from === vinylC1) || (b.to === vinylC1))
  );
  if (!vinylBond) return null;

  const vinylC2Idx = vinylBond.from === vinylC1 ? vinylBond.to : vinylBond.from;
  const c2 = atomById.get(vinylC2Idx);
  if (!c2 || c2.element !== "C") return null;

  // vinylC2 must be terminal (only bonds to vinylC1 and H's), i.e. =CH2
  const c2Bonds = graph.bonds.filter(b => (b.from === vinylC2Idx || b.to === vinylC2Idx));
  const c2NonHNbrs = c2Bonds
    .map(b => b.from === vinylC2Idx ? b.to : b.from)
    .filter(idx => (atomById.get(idx)?.element ?? "H") !== "H");
  if (c2NonHNbrs.length !== 1 || c2NonHNbrs[0] !== vinylC1) return null; // not terminal

  // vinylC1 must have no other non-ring, non-H, non-vinylC2 neighbors
  const c1Bonds = graph.bonds.filter(b => (b.from === vinylC1 || b.to === vinylC1));
  const c1NonHNbrs = c1Bonds
    .map(b => b.from === vinylC1 ? b.to : b.from)
    .filter(idx => (atomById.get(idx)?.element ?? "H") !== "H");
  // c1NonHNbrs should be: exactly 1 ring atom + vinylC2
  const c1Expected = new Set([...ringSet, vinylC2Idx]);
  if (!c1NonHNbrs.every(idx => c1Expected.has(idx))) return null;

  return "styrene";
}

/** Collect all atoms in the subtree from start, blocked by from, using exo carbon graph. */
function collectSubtreeAtoms(cg: CarbonGraph, start: number, from: number): number[] {
  const seen = new Set<number>([from]);
  const stack = [start];
  const out: number[] = [];
  while (stack.length) {
    const u = stack.pop()!;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    for (const v of cg.adj.get(u) ?? []) {
      if (!seen.has(v)) stack.push(v);
    }
  }
  return out;
}

/**
 * Handle the case where the ring becomes a substituent on a chain parent.
 * The PCG is on a chain (not the ring), and the ring hangs off the chain.
 */
function nameMoleculeRingAsSubstituent(
  graph: MolGraph,
  ring: import("./ring").RingInfo,
  groups: Group[],
  pcgKind: GroupKind,
  pcgGroups: Group[],
): NameResult {
  const heavy = graph.atoms.filter((a) => a.element !== "H");
  const ringSet = new Set(ring.atoms);

  // The ring naming (to get the substituent name: phenyl, cyclohexyl, pyridin-2-yl, etc.)
  // For ring-as-substituent, we need to find the attachment locant first

  // Build the chain (non-ring) carbon graph
  const cg = buildCarbonGraph(graph);
  // Remove ring carbons from the CarbonGraph
  for (const idx of ringSet) {
    cg.carbons = cg.carbons.filter(c => c !== idx);
    cg.adj.delete(idx);
    for (const [, list] of cg.adj) {
      const i = list.indexOf(idx);
      if (i >= 0) list.splice(i, 1);
    }
  }

  // Find the chain carbon attached to the ring
  // (the ring-to-chain attachment bond)
  let ringAttachAtom: number | null = null;
  let chainAttachAtom: number | null = null;
  for (const b of graph.bonds) {
    if (ringSet.has(b.from) && !ringSet.has(b.to) && graph.atoms.find(a => a.index === b.to)?.element === "C") {
      ringAttachAtom = b.from;
      chainAttachAtom = b.to;
      break;
    }
    if (ringSet.has(b.to) && !ringSet.has(b.from) && graph.atoms.find(a => a.index === b.from)?.element === "C") {
      ringAttachAtom = b.to;
      chainAttachAtom = b.from;
      break;
    }
  }

  if (ringAttachAtom === null || chainAttachAtom === null) {
    return { name: null, status: "unsupported", reason: "ring not attached to chain via carbon — not supported" };
  }

  // Get the ring naming to get locant for the attachment
  const ringNaming = nameRing(graph, ring, {});
  if (!ringNaming) {
    return { name: null, status: "unsupported", reason: "ring not yet supported — Tier 4" };
  }

  const attachLocant = ringNaming.locantOf.get(ringAttachAtom) ?? 1;
  const ringSub = ringSubstituentName(ringNaming.parent, ringNaming.kind, attachLocant);

  // Verify only ONE ring-to-chain attachment (spiro/bridged → decline)
  const ringChainBonds = graph.bonds.filter(b =>
    (ringSet.has(b.from) && !ringSet.has(b.to)) || (ringSet.has(b.to) && !ringSet.has(b.from))
  ).filter(b => graph.atoms.find(a => a.index === (ringSet.has(b.from) ? b.to : b.from))?.element !== "H");

  if (ringChainBonds.length > 1) {
    // Multiple ring-chain bonds (e.g. spiro) → unsupported
    return { name: null, status: "unsupported", reason: "multiple ring-chain attachments — not supported in this tier" };
  }

  // Now name the chain using existing machinery (same as acyclic path)
  // The chain CG no longer contains ring carbons
  // We treat the ring substituent just like an alkyl branch attached at chainAttachAtom

  // Re-use the existing chain naming logic:
  const CARBON_PREFIX = new Set<GroupKind>(["nitrile", "acid", "amide"]);
  const excludedCarbons = new Set<number>();
  if (pcgKind) {
    for (const g of groups) {
      if (g.kind !== pcgKind && CARBON_PREFIX.has(g.kind)) excludedCarbons.add(g.carbon);
    }
  }
  if (excludedCarbons.size > 0) {
    cg.carbons = cg.carbons.filter(c => !excludedCarbons.has(c));
    for (const c of excludedCarbons) cg.adj.delete(c);
    for (const [, list] of cg.adj) {
      for (let i = list.length - 1; i >= 0; i--) if (excludedCarbons.has(list[i])) list.splice(i, 1);
    }
  }

  const pcgCarbons = pcgGroups.map(g => g.carbon).filter(c => !ringSet.has(c));
  const chain = selectPrincipalChain(cg, { pcgCarbons }).atoms;
  const inChain = new Set(chain);

  // ene/yne locants on chain
  const doubles: number[] = [];
  const triples: number[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const o = ccOrder(cg, chain[i], chain[i + 1]);
    if (o === 2) doubles.push(i + 1);
    if (o === 3) triples.push(i + 1);
  }

  const groupAtomSet = new Set<number>();
  for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);

  const subs: { locant: number; name: string }[] = [];
  const nonPcgGroups = pcgKind
    ? groups.filter(g => SENIORITY[g.kind] < SENIORITY[pcgKind] || SENIORITY[g.kind] === 0)
    : groups;

  for (const g of nonPcgGroups) {
    const anchor = CARBON_PREFIX.has(g.kind)
      ? neighborsOf(graph, g.carbon).find(n => inChain.has(n))
      : (inChain.has(g.carbon) ? g.carbon : undefined);
    if (anchor === undefined) continue;
    subs.push({ locant: chain.indexOf(anchor) + 1, name: prefixForm(g) });
  }

  // Alkyl branch substituents
  for (let i = 0; i < chain.length; i++) {
    for (const nb of cg.adj.get(chain[i]) ?? []) {
      if (!inChain.has(nb) && !groupAtomSet.has(nb)) {
        subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, chain[i]) });
      }
    }
  }

  // Add ring as substituent at chainAttachAtom's chain position.
  // CLASS 1 (NO WRONG NAMES): the ring may attach only at a main-chain carbon. If
  // the ring hangs off a BRANCH carbon (chainAttachAtom is not on the selected
  // main chain), the substituent branch contains a ring we cannot express — the
  // acyclic substituent namer would silently drop the ring atoms (e.g.
  // CC(C)(C)C(Cc1ccccc1)C(=O)O → "2,3,3-trimethylbutanoic acid", dropping benzyl).
  // Decline rather than emit a name that omits the ring.
  const chainPos = chain.indexOf(chainAttachAtom!);
  if (chainPos < 0) {
    return {
      name: null,
      status: "unsupported",
      reason: "ring-containing substituent not yet supported — Tier 4",
    };
  }
  subs.push({ locant: chainPos + 1, name: ringSub });

  // Completeness guard: chain atoms + group atoms + ring atoms + ring substituent atoms
  const accounted = new Set<number>([...chain, ...ring.atoms]);
  for (const g of groups) {
    if (inChain.has(g.carbon)) for (const a of g.atoms) accounted.add(a);
    else if (excludedCarbons.has(g.carbon) && neighborsOf(graph, g.carbon).some(n => inChain.has(n))) {
      accounted.add(g.carbon);
      for (const a of g.atoms) accounted.add(a);
    }
  }
  for (const c of chain) {
    for (const nb of cg.adj.get(c) ?? []) {
      if (!inChain.has(nb) && !groupAtomSet.has(nb)) {
        for (const a of branchCarbons(cg, nb, inChain)) accounted.add(a);
      }
    }
  }
  if (heavy.some(a => !accounted.has(a.index))) {
    return { name: null, status: "unsupported", reason: "contains a substituent or arrangement not yet supported in this tier" };
  }

  // Multiple-bond guard
  for (const b of graph.bonds) {
    if (b.order < 2) continue;
    // Ring bonds are fine
    if (ringSet.has(b.from) && ringSet.has(b.to)) continue;
    const ia = chain.indexOf(b.from), ib = chain.indexOf(b.to);
    if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) continue; // on-chain
    if (groups.some(g => g.atoms.includes(b.from) || g.atoms.includes(b.to))) continue;
    if (groups.some(g => g.atoms.includes(b.from) || g.atoms.includes(b.to))) continue;
    return { name: null, status: "unsupported", reason: "contains a multiple bond not on the main chain — not yet supported" };
  }

  // Suffix
  let suffix: import("./assemble").SuffixSpec | undefined;
  if (pcgKind && pcgGroups.length > 0) {
    const suffixLocants = pcgGroups
      .map(g => chain.indexOf(g.carbon) + 1)
      .filter(l => l > 0)
      .sort((a, b) => a - b);
    suffix = { kind: toSuffixKind(pcgKind), locants: suffixLocants };
  }

  const nameTxt = assembleName({ chainLen: chain.length, doubles, triples, subs, suffix });
  return { name: nameTxt, status: "named", parentChain: chain };
}

export function nameMolecule(graph: MolGraph): NameResult {
  const heavy = graph.atoms.filter((a) => a.element !== "H");
  if (heavy.length === 0) return { name: null, status: "empty" };

  // Structural checks (multiple fragments, charged atoms)
  const structErr = structuralRejectReason(graph);
  if (structErr) return { name: null, status: "unsupported", reason: structErr };

  // Element gate: only C/H/O/N/F/Cl/Br/I supported (also S for heterocycles)
  for (const a of graph.atoms) {
    if (!SUPPORTED_ELEMENTS.has(a.element)) {
      return { name: null, status: "unsupported", reason: `contains ${a.element} — later tier` };
    }
  }

  // ── Route ring molecules to Tier-3 ring path ──────────────────────────────
  if (hasRing(graph)) {
    return nameMoleculeRing(graph);
  }

  // Functional-group perception
  const perception = perceiveGroups(graph);
  if (perception.unsupported) {
    return { name: null, status: "unsupported", reason: perception.unsupported };
  }

  const groups = perception.groups;

  // Check that every heteroatom (non-C, non-H) is accounted for by a recognized group.
  // An unclassified heteroatom means we don't know how to name it.
  {
    const groupAtomSet = new Set<number>();
    for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);
    for (const a of graph.atoms) {
      if (a.element === "C" || a.element === "H") continue;
      if (!groupAtomSet.has(a.index)) {
        const elementName: Record<string, string> = {
          O: "oxygen", N: "nitrogen", F: "fluorine", Cl: "chlorine", Br: "bromine", I: "iodine",
        };
        const eName = elementName[a.element] ?? a.element;
        return {
          name: null,
          status: "unsupported",
          reason: `contains unclassified ${eName} — functional group not recognized in this tier`,
        };
      }
    }
  }

  try {
    const cg = buildCarbonGraph(graph);

    // Determine principal characteristic group (PCG)
    const pcgKind = principalKind(groups);
    const pcgGroups = pcgKind ? groups.filter((g) => g.kind === pcgKind) : [];
    const pcgCarbons = pcgGroups.map((g) => g.carbon);

    // ── CLASS 2 (NO WRONG NAMES): acid derivative as a non-principal prefix ─────
    // acylHalide/ester/anhydride have no real detachable prefix in this engine —
    // prefixForm returns placeholders ("haloformyl", "alkoxycarbonyl", "anhydride")
    // that are not valid IUPAC and that OPSIN cannot parse. When such a group is
    // present but is NOT the principal characteristic group (a more senior group
    // outranks it), it would have to be cited as a prefix → decline instead of
    // emitting a bogus name (e.g. COC(C(=O)O)C(=O)F).
    if (groups.some((g) => isTwoPart(g.kind) && g.kind !== pcgKind)) {
      return {
        name: null,
        status: "unsupported",
        reason: "acid derivative as substituent prefix not yet supported — Tier 4",
      };
    }

    // ── Two-part naming path (Tier 2b): acylHalide / ester / anhydride ─────────
    if (pcgKind && isTwoPart(pcgKind)) {
      const groupAtomSet = new Set<number>();
      for (const g of groups) for (const a of g.atoms) groupAtomSet.add(a);

      // We only support a single PCG group of each two-part kind (no diester naming yet,
      // except butanedioyl dichloride which is two acylHalide groups on one chain).
      // For diacyl halides: two acylHalide groups sharing a carbon chain → handled below.

      if (pcgKind === "acylHalide") {
        // All acylHalide groups must share a single carbon chain.
        const pcgAcylHalides = pcgGroups; // all are acylHalide

        // Build acyl chain(s): collect all acyl carbons and halogen atoms
        // For one acyl halide: simple chain from acylC; for two (diacyl dichloride): both termini
        const halDetails = pcgAcylHalides.map((g) => g.detail ?? "Cl");

        // Check all halogens are the same element for "diacyl dihalide" form
        const distinctHals = new Set(halDetails);
        if (distinctHals.size > 1) {
          return { name: null, status: "unsupported", reason: "mixed diacyl dihalide — not yet supported" };
        }

        const halogen = halDetails[0];

        if (pcgAcylHalides.length === 1) {
          // Single acyl halide
          const g = pcgAcylHalides[0];
          const chain = describeAcylChain(cg, g.carbon, groupAtomSet);
          if (!chain) return { name: null, status: "unsupported", reason: "acyl chain not expressible" };

          // Completeness: all carbons in chain + all group atoms must cover all heavy atoms
          const accounted = new Set<number>([...chain.chainAtoms, ...g.atoms]);
          // Add alkyl branch atoms
          for (let i = 0; i < chain.chainAtoms.length; i++) {
            for (const nb of cg.adj.get(chain.chainAtoms[i]) ?? []) {
              if (!new Set(chain.chainAtoms).has(nb) && !groupAtomSet.has(nb)) {
                for (const ba of [...subtreeAtoms(cg, nb, chain.chainAtoms[i])]) accounted.add(ba);
              }
            }
          }
          if (heavy.some((a) => !accounted.has(a.index))) {
            return { name: null, status: "unsupported", reason: "contains a substituent or arrangement not yet supported in this tier" };
          }
          // Multiple-bond guard
          for (const b of graph.bonds) {
            if (b.order < 2) continue;
            const ia = chain.chainAtoms.indexOf(b.from), ib = chain.chainAtoms.indexOf(b.to);
            if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) continue; // on-chain
            if (g.atoms.includes(b.from) || g.atoms.includes(b.to)) continue; // carbonyl bond
            return { name: null, status: "unsupported", reason: "contains a multiple bond not on the main chain — not yet supported" };
          }

          const acyl = acylName(chain.chainLen, chain.doubles, chain.triples, chain.subs);
          return { name: acylHalideName(acyl, halogen), status: "named", parentChain: chain.chainAtoms };

        } else if (pcgAcylHalides.length === 2) {
          // Diacyl dihalide: both acyl carbons are termini of the same chain.
          // e.g. ClC(=O)CCC(=O)Cl → butanedioyl dichloride
          const [g1, g2] = pcgAcylHalides;

          // BFS path between the two acyl carbons (avoiding group heteroatoms)
          const pathParent = new Map<number, number>();
          const pathSeen = new Set<number>([g1.carbon]);
          const pathQueue = [g1.carbon];
          while (pathQueue.length) {
            const u = pathQueue.shift()!;
            if (u === g2.carbon) break;
            for (const v of cg.adj.get(u) ?? []) {
              if (!pathSeen.has(v) && !groupAtomSet.has(v)) {
                pathSeen.add(v); pathParent.set(v, u); pathQueue.push(v);
              }
            }
          }
          if (!pathSeen.has(g2.carbon)) {
            return { name: null, status: "unsupported", reason: "diacyl carbons not connected" };
          }
          const chainPath: number[] = [g2.carbon];
          let cur = g2.carbon;
          while (cur !== g1.carbon) { cur = pathParent.get(cur)!; chainPath.push(cur); }
          const chainAtomsDi = chainPath.reverse();
          const chainLenDi = chainAtomsDi.length;
          const inChainSetDi = new Set(chainAtomsDi);

          // ene/yne locants
          const doublesDi: number[] = [], triplesDi: number[] = [];
          for (let i = 0; i < chainAtomsDi.length - 1; i++) {
            const o = ccOrder(cg, chainAtomsDi[i], chainAtomsDi[i + 1]);
            if (o === 2) doublesDi.push(i + 1);
            if (o === 3) triplesDi.push(i + 1);
          }

          // Substituents on the chain
          const subsDi: Sub[] = [];
          for (let i = 0; i < chainAtomsDi.length; i++) {
            for (const nb of cg.adj.get(chainAtomsDi[i]) ?? []) {
              if (!inChainSetDi.has(nb) && !groupAtomSet.has(nb)) {
                subsDi.push({ locant: i + 1, name: nameSubstituent(cg, nb, chainAtomsDi[i]) });
              }
            }
          }

          // Completeness
          const accountedDi = new Set<number>(chainAtomsDi);
          for (const g of pcgAcylHalides) for (const a of g.atoms) accountedDi.add(a);
          for (let i = 0; i < chainAtomsDi.length; i++) {
            for (const nb of cg.adj.get(chainAtomsDi[i]) ?? []) {
              if (!inChainSetDi.has(nb) && !groupAtomSet.has(nb)) {
                for (const ba of subtreeAtoms(cg, nb, chainAtomsDi[i])) accountedDi.add(ba);
              }
            }
          }
          if (heavy.some((a) => !accountedDi.has(a.index))) {
            return { name: null, status: "unsupported", reason: "contains a substituent or arrangement not yet supported in this tier" };
          }

          // Multiple-bond guard for diacyl
          for (const b of graph.bonds) {
            if (b.order < 2) continue;
            const ia = chainAtomsDi.indexOf(b.from), ib = chainAtomsDi.indexOf(b.to);
            if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) continue;
            // Group bonds (C=O for either acyl halide)
            if (pcgAcylHalides.some((g) => g.atoms.includes(b.from) || g.atoms.includes(b.to))) continue;
            return { name: null, status: "unsupported", reason: "contains a multiple bond not on the main chain — not yet supported" };
          }

          // Build "butanedioyl dichloride" style name.
          // Strategy: derive from acylName (mono-acyl) by converting "oyl" → "edioyl".
          // e.g. "butanoyl" → "butanedioyl" (restores elided 'e', adds 'dioyl').
          // Handles unsaturation automatically (e.g. "but-2-enoyl" → "but-2-enedioyl").
          const acylSide1 = acylName(chainLenDi, doublesDi, triplesDi, subsDi);
          // acylSide1 ends in "oyl"; for the diacyl (symmetrical both-ends) form we need "dioyl".
          // Derivation: acyl = stem + "ane" → e-elision → stem + "an" + "oyl" = "butanoyl".
          // Diacyl = stem + "ane" + "dioyl" (no e-elision before 'd') = "butanedioyl".
          // So: replace trailing "oyl" with "edioyl" (restores the elided 'e', then adds 'dioyl').
          const diacylName2 = acylSide1.endsWith("oyl")
            ? acylSide1.slice(0, -3) + "edioyl"
            : acylSide1 + "edioyl";
          const halWordDi = halogen === "Cl" ? "chloride" : halogen === "Br" ? "bromide" :
            halogen === "F" ? "fluoride" : "iodide";
          return { name: `${diacylName2} di${halWordDi}`, status: "named", parentChain: chainAtomsDi };
        } else {
          return { name: null, status: "unsupported", reason: "more than 2 acyl halide groups — not yet supported" };
        }
      }

      if (pcgKind === "ester") {
        if (pcgGroups.length !== 1) {
          return { name: null, status: "unsupported", reason: "multiple ester groups — not yet supported" };
        }
        const g = pcgGroups[0];
        // atoms[0] = =O, atoms[1] = bridging O (as set in functionalGroups.ts)
        const carbonylOIdx = g.atoms[0];
        const bridgeOIdx = g.atoms[1];

        // Describe the acyl chain (from g.carbon = acylCarbonIdx)
        const acylChain = describeAcylChain(cg, g.carbon, groupAtomSet);
        if (!acylChain) return { name: null, status: "unsupported", reason: "ester acyl chain not expressible" };

        // Describe the O-alkyl chain (from bridgeOIdx)
        const oAlkyl = describeOAlkylChain(graph, cg, bridgeOIdx, g.carbon);
        if (!oAlkyl) return { name: null, status: "unsupported", reason: "ester O-alkyl chain not expressible" };

        // Completeness: chain atoms + group atoms (=O + bridgeO) + alkyl atoms must cover all heavy atoms
        const accounted = new Set<number>([...acylChain.chainAtoms]);
        accounted.add(carbonylOIdx);
        accounted.add(bridgeOIdx);
        for (const a of oAlkyl.alkylAtoms) accounted.add(a);
        // Add any alkyl branches on the acyl chain
        const inAcylChain = new Set(acylChain.chainAtoms);
        for (let i = 0; i < acylChain.chainAtoms.length; i++) {
          for (const nb of cg.adj.get(acylChain.chainAtoms[i]) ?? []) {
            if (!inAcylChain.has(nb) && !groupAtomSet.has(nb)) {
              for (const ba of [...subtreeAtoms(cg, nb, acylChain.chainAtoms[i])]) accounted.add(ba);
            }
          }
        }
        if (heavy.some((a) => !accounted.has(a.index))) {
          return { name: null, status: "unsupported", reason: "contains a substituent or arrangement not yet supported in this tier" };
        }
        // Multiple-bond guard: only on-chain bonds and the C=O bond
        for (const b of graph.bonds) {
          if (b.order < 2) continue;
          const ia = acylChain.chainAtoms.indexOf(b.from), ib = acylChain.chainAtoms.indexOf(b.to);
          if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) continue; // on-chain ene/yne
          if (b.from === g.carbon && b.to === carbonylOIdx) continue; // C=O
          if (b.to === g.carbon && b.from === carbonylOIdx) continue; // C=O
          return { name: null, status: "unsupported", reason: "contains a multiple bond not on the main chain — not yet supported" };
        }

        const nameTxt = esterName(oAlkyl.alkylName, acylChain.chainLen, acylChain.doubles, acylChain.triples, acylChain.subs);
        return { name: nameTxt, status: "named", parentChain: acylChain.chainAtoms };
      }

      if (pcgKind === "anhydride") {
        if (pcgGroups.length !== 1) {
          return { name: null, status: "unsupported", reason: "multiple anhydride groups — not yet supported" };
        }
        const g = pcgGroups[0];
        // atoms[0] = bridgingO, atoms[1] = =O of carbon1, atoms[2] = =O of carbon2
        const bridgeOIdx = g.atoms[0];
        const c1Idx = g.carbon;
        const c2Idx = Number(g.detail);

        // Describe both acyl chains
        const chain1 = describeAcylChain(cg, c1Idx, groupAtomSet);
        const chain2 = describeAcylChain(cg, c2Idx, groupAtomSet);
        if (!chain1 || !chain2) return { name: null, status: "unsupported", reason: "anhydride acyl chain not expressible" };

        // Completeness
        const accounted = new Set<number>([...chain1.chainAtoms, ...chain2.chainAtoms]);
        accounted.add(bridgeOIdx);
        for (const a of g.atoms) accounted.add(a);
        // Add alkyl branches
        const inC1 = new Set(chain1.chainAtoms);
        const inC2 = new Set(chain2.chainAtoms);
        for (let i = 0; i < chain1.chainAtoms.length; i++) {
          for (const nb of cg.adj.get(chain1.chainAtoms[i]) ?? []) {
            if (!inC1.has(nb) && !groupAtomSet.has(nb)) {
              for (const ba of [...subtreeAtoms(cg, nb, chain1.chainAtoms[i])]) accounted.add(ba);
            }
          }
        }
        for (let i = 0; i < chain2.chainAtoms.length; i++) {
          for (const nb of cg.adj.get(chain2.chainAtoms[i]) ?? []) {
            if (!inC2.has(nb) && !groupAtomSet.has(nb)) {
              for (const ba of [...subtreeAtoms(cg, nb, chain2.chainAtoms[i])]) accounted.add(ba);
            }
          }
        }
        if (heavy.some((a) => !accounted.has(a.index))) {
          return { name: null, status: "unsupported", reason: "contains a substituent or arrangement not yet supported in this tier" };
        }
        // Multiple-bond guard: each multi-bond must be on-chain (for either side) or a group bond.
        for (const b of graph.bonds) {
          if (b.order < 2) continue;
          // On-chain for either side
          const ia1 = chain1.chainAtoms.indexOf(b.from), ib1 = chain1.chainAtoms.indexOf(b.to);
          if (ia1 >= 0 && ib1 >= 0 && Math.abs(ia1 - ib1) === 1) continue;
          const ia2 = chain2.chainAtoms.indexOf(b.from), ib2 = chain2.chainAtoms.indexOf(b.to);
          if (ia2 >= 0 && ib2 >= 0 && Math.abs(ia2 - ib2) === 1) continue;
          // Group bond (either C=O)
          if (g.atoms.includes(b.from) || g.atoms.includes(b.to)) continue;
          return { name: null, status: "unsupported", reason: "contains a multiple bond not on the main chain — not yet supported" };
        }

        const side1 = acidStem(chain1.chainLen, chain1.doubles, chain1.triples, chain1.subs);
        const side2 = acidStem(chain2.chainLen, chain2.doubles, chain2.triples, chain2.subs);
        return { name: anhydrideName(side1, side2), status: "named", parentChain: chain1.chainAtoms };
      }
    }
    // ── End two-part routing ───────────────────────────────────────────────────

    // Non-principal groups that carry their OWN carbon become carbon-bearing
    // prefixes (nitrile→cyano, acid→carboxy, amide→carbamoyl). That carbon is
    // part of the SUBSTITUENT, not the parent chain, so exclude it from chain
    // selection — e.g. HOOC–C≡C–C≡N is 3-cyanoprop-2-ynoic acid, not
    // 4-cyanobut-2-ynoic acid (which would double-count the nitrile carbon).
    const CARBON_PREFIX = new Set<GroupKind>(["nitrile", "acid", "amide"]);
    const excludedCarbons = new Set<number>();
    if (pcgKind) {
      for (const g of groups) {
        if (g.kind !== pcgKind && CARBON_PREFIX.has(g.kind)) excludedCarbons.add(g.carbon);
      }
    }
    if (excludedCarbons.size > 0) {
      cg.carbons = cg.carbons.filter((c) => !excludedCarbons.has(c));
      for (const c of excludedCarbons) cg.adj.delete(c);
      for (const [, list] of cg.adj) {
        for (let i = list.length - 1; i >= 0; i--) if (excludedCarbons.has(list[i])) list.splice(i, 1);
      }
    }

    // For chain selection, only true suffix-PCG carbons get priority over unsaturation.
    // When there is no suffix PCG (prefix-only groups: halo, alkoxy, nitro, etc.),
    // pass [] so that orient() gives C=C/C≡C the lowest locants first (IUPAC P-44.1),
    // with detachable prefixes handled in the substituent-locant tier afterward.
    const chainPrefCarbons = pcgCarbons.length > 0 ? pcgCarbons : [];

    // Build the FG-prefix anchor map for the substituent-locant and alpha tie-break.
    // This allows chain orientation to include detachable prefix positions in the
    // substituent set (same tier as alkyl branches) — IUPAC P-44.3.
    // NOTE: built before chain selection because orient() needs it for the tie-break.
    const fgPrefixAnchors = new Map<number, string>();
    if (pcgCarbons.length === 0) {
      // Only populate when there's no suffix PCG (otherwise the PCG tier already handles it).
      const preNonPcgGroups = pcgKind
        ? groups.filter((g) => SENIORITY[g.kind] < SENIORITY[pcgKind] || SENIORITY[g.kind] === 0)
        : groups;
      for (const g of preNonPcgGroups) {
        if (g.kind === "ether") {
          // Identify the chain-side carbon and the alkoxy prefix name without needing
          // to know the chain yet (uses the smaller-subtree heuristic).
          const result = etherPrefixAndChainC(graph, g);
          if (result) {
            fgPrefixAnchors.set(result.chainC, result.prefix);
          }
        } else if (!CARBON_PREFIX.has(g.kind)) {
          // For carbon-bearing non-PCG prefixes (cyano/carboxy/carbamoyl), the anchor
          // on the chain is a NEIGHBOR of g.carbon (g.carbon itself was excluded from cg).
          // We can't easily determine this pre-chain-selection, so skip them here;
          // they are rare and the alpha tie-break will remain correct without them.
          // All other prefix groups: anchor is g.carbon directly.
          // (halide: X on g.carbon; alcohol-as-prefix: O on g.carbon; nitro; etc.)
          fgPrefixAnchors.set(g.carbon, prefixForm(g));
        }
      }
    }

    // Select principal chain with PCG priority and FG-prefix anchors for tie-breaking
    const chain = selectPrincipalChain(cg, {
      pcgCarbons: chainPrefCarbons,
      fgPrefixAnchors: fgPrefixAnchors.size > 0 ? fgPrefixAnchors : undefined,
    }).atoms;
    const inChain = new Set(chain);

    // Compute ene/yne locants
    const doubles: number[] = [];
    const triples: number[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const o = ccOrder(cg, chain[i], chain[i + 1]);
      if (o === 2) doubles.push(i + 1);
      if (o === 3) triples.push(i + 1);
    }

    // Build substituent list:
    // (a) Tier-1 alkyl branches (carbons off the chain)
    // (b) Non-principal functional group prefixes (FG prefix form)
    const subs: { locant: number; name: string }[] = [];

    // Groups that are NOT the PCG get turned into prefixes
    const nonPcgGroups = pcgKind
      ? groups.filter((g) => SENIORITY[g.kind] < SENIORITY[pcgKind] || SENIORITY[g.kind] === 0)
      : groups;

    // Resolve ether prefix names before building subs
    const etherResolved = new Map<number, string>(); // group index → resolved prefix
    nonPcgGroups.forEach((g, gi) => {
      if (g.kind === "ether") {
        etherResolved.set(gi, etherPrefixFor(graph, g, inChain));
      }
    });

    // Track atoms belonging to groups (so we don't double-count as carbon branches)
    const groupAtoms = new Set<number>();
    for (const g of groups) {
      for (const a of g.atoms) groupAtoms.add(a);
    }

    // Add FG prefix substituents
    for (let gi = 0; gi < nonPcgGroups.length; gi++) {
      const g = nonPcgGroups[gi];
      if (g.kind === "ether") {
        // Anchor the ether at whichever of its two carbons is on the main chain.
        const onChain = neighborsOf(graph, g.atoms[0]).find((n) => inChain.has(n));
        if (onChain === undefined) continue; // both sides off-chain → completeness guard declines
        subs.push({ locant: chain.indexOf(onChain) + 1, name: etherResolved.get(gi) ?? "alkoxy" });
        continue;
      }
      // Carbon-bearing prefixes (cyano/carboxy/carbamoyl) sit on their chain
      // neighbour, since their own carbon was excluded from the chain.
      const anchor = CARBON_PREFIX.has(g.kind)
        ? neighborsOf(graph, g.carbon).find((n) => inChain.has(n))
        : (inChain.has(g.carbon) ? g.carbon : undefined);
      if (anchor === undefined) continue; // off-chain → completeness guard declines
      subs.push({ locant: chain.indexOf(anchor) + 1, name: prefixForm(g) });
    }

    // Add alkyl branch substituents (carbons off-chain not belonging to any group).
    // Also handle simple haloalkyl branches (e.g. CH2F → fluoromethyl).
    // haloalkylAccounted: extra non-carbon atoms accounted by haloalkyl branch naming.
    const haloalkylAccounted = new Set<number>();
    for (let i = 0; i < chain.length; i++) {
      for (const nb of cg.adj.get(chain[i]) ?? []) {
        if (!inChain.has(nb) && !groupAtoms.has(nb)) {
          // Try haloalkyl naming first (handles CH2F, CH2Cl, etc.)
          const haloName = nameHaloalkylBranch(graph, nb, chain[i], groupAtoms);
          if (haloName !== null) {
            // Haloalkyl substituent names (e.g. "fluoromethyl") are complex substituents
            // and require enclosing marks (parentheses) per IUPAC. We pass them with
            // a leading/trailing paren so assembleName treats them as complex.
            // The displayName function in assemble.ts wraps in parens only when isComplex
            // returns true (name contains a digit); since "fluoromethyl" has no digit,
            // we pre-wrap it here to ensure correct IUPAC parenthesization.
            subs.push({ locant: i + 1, name: `(${haloName})` });
            // Collect all atoms in the haloalkyl branch for the completeness guard.
            const bvisited = new Set<number>([chain[i]]);
            const bstack = [nb];
            while (bstack.length) {
              const u = bstack.pop()!;
              if (bvisited.has(u)) continue;
              bvisited.add(u);
              const atom = graph.atoms.find((a) => a.index === u);
              if (atom && atom.element !== "H") haloalkylAccounted.add(u);
              for (const b of graph.bonds) {
                const nbr2 = b.from === u ? b.to : b.to === u ? b.from : -1;
                if (nbr2 >= 0 && !bvisited.has(nbr2)) bstack.push(nbr2);
              }
            }
          } else {
            subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, chain[i]) });
          }
        }
      }
    }

    // ── Completeness guard ──────────────────────────────────────────────────
    // Every heavy atom must be expressed by the name: a main-chain atom, an atom
    // of a group whose anchor is on the chain, an atom of a simple alkoxy side,
    // or a carbon in an alkyl branch. If any heavy atom is left unaccounted (a
    // dropped N-substituent, a substituent on an ether/alkoxy carbon, an enol
    // OH, …) we DECLINE rather than emit a name that silently omits atoms.
    const accounted = new Set<number>(chain);
    for (const g of groups) {
      if (g.kind === "ether") {
        const alk = etherAlkoxyAtoms(graph, g.atoms[0], inChain);
        if (alk) for (const a of alk) accounted.add(a);
        continue;
      }
      if (inChain.has(g.carbon)) {
        for (const a of g.atoms) accounted.add(a);
      } else if (excludedCarbons.has(g.carbon) && neighborsOf(graph, g.carbon).some((n) => inChain.has(n))) {
        // Carbon-bearing prefix attached to the chain: account its own carbon + heteroatoms.
        accounted.add(g.carbon);
        for (const a of g.atoms) accounted.add(a);
      }
    }
    for (const c of chain) {
      for (const nb of cg.adj.get(c) ?? []) {
        if (!inChain.has(nb) && !groupAtoms.has(nb)) {
          for (const a of branchCarbons(cg, nb, inChain)) accounted.add(a);
        }
      }
    }
    // Also account for atoms covered by haloalkyl branch naming
    for (const a of haloalkylAccounted) accounted.add(a);
    if (heavy.some((a) => !accounted.has(a.index))) {
      return {
        name: null,
        status: "unsupported",
        reason: "contains a substituent or arrangement not yet supported in this tier",
      };
    }

    // ── Multiple-bond guard ─────────────────────────────────────────────────
    // Each double/triple bond must be a consecutive main-chain ene/yne, or a
    // recognized group bond (C=O carbonyl, C≡N nitrile). A multiple bond to a
    // branch, an enol/enamine C=C, an imine C=N, etc. is not expressible → decline.
    for (const b of graph.bonds) {
      if (b.order < 2) continue;
      const ia = chain.indexOf(b.from);
      const ib = chain.indexOf(b.to);
      if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1) continue; // on-chain ene/yne
      if (groups.some((g) => g.atoms.includes(b.from) && g.atoms.includes(b.to))) continue;
      // carbonyl/nitrile: group records only the heteroatom; the C is the anchor.
      if (groups.some((g) => g.atoms.includes(b.from) || g.atoms.includes(b.to))) continue;
      return {
        name: null,
        status: "unsupported",
        reason: "contains a multiple bond not on the main chain — not yet supported",
      };
    }

    // Build suffix spec for the PCG
    let suffix: { kind: SuffixKind; locants: number[] } | undefined;
    if (pcgKind && pcgGroups.length > 0) {
      const suffixLocants = pcgGroups
        .map((g) => chain.indexOf(g.carbon) + 1)
        .filter((l) => l > 0)
        .sort((a, b) => a - b);
      suffix = { kind: toSuffixKind(pcgKind), locants: suffixLocants };
    }

    const nameTxt = assembleName({
      chainLen: chain.length,
      doubles,
      triples,
      subs,
      suffix,
    });
    return { name: nameTxt, status: "named", parentChain: chain };
  } catch (e) {
    return { name: null, status: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}
