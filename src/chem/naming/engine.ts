// src/chem/naming/engine.ts
import type { MolGraph, NameResult } from "./graph";
import { buildCarbonGraph, ccOrder, selectPrincipalChain, type CarbonGraph } from "./chain";
import { nameSubstituent } from "./substituent";
import { assembleName, acylName, acylHalideName, esterName, anhydrideName, type SuffixKind, type Sub } from "./assemble";
import { perceiveGroups, principalKind, SENIORITY, type Group, type GroupKind } from "./functionalGroups";

/**
 * Elements supported by Tier 2 (C, H, O, N, F, Cl, Br, I).
 * Anything else → unsupported.
 */
const SUPPORTED_ELEMENTS = new Set(["C", "H", "O", "N", "F", "Cl", "Br", "I"]);

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

/** Structural sanity gate (fragments, rings, charge) — checked BEFORE perception. */
function structuralRejectReason(graph: MolGraph): string | null {
  if (graph.fragmentCount > 1) return "multiple fragments — arrives in a later tier";
  if (graph.atoms.some((a) => a.ringIds.length > 0)) return "contains a ring — arrives in Tier 3";
  if (hasHeavyAtomCycle(graph)) return "contains a ring — arrives in Tier 3";
  if (graph.atoms.some((a) => a.charge !== 0)) return "contains a charged atom — later tier";
  return null;
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

export function nameMolecule(graph: MolGraph): NameResult {
  const heavy = graph.atoms.filter((a) => a.element !== "H");
  if (heavy.length === 0) return { name: null, status: "empty" };

  // Structural checks first (rings, multiple fragments, charged atoms)
  const structErr = structuralRejectReason(graph);
  if (structErr) return { name: null, status: "unsupported", reason: structErr };

  // Element gate: only C/H/O/N/F/Cl/Br/I supported
  for (const a of graph.atoms) {
    if (!SUPPORTED_ELEMENTS.has(a.element)) {
      return { name: null, status: "unsupported", reason: `contains ${a.element} — later tier` };
    }
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

    // For chain selection, if we have a PCG use its anchors; otherwise use all
    // group anchor carbons so the chain orientation minimises their locants too.
    const chainPrefCarbons = pcgCarbons.length > 0
      ? pcgCarbons
      : groups.map((g) => g.carbon);

    // Select principal chain with PCG priority
    const chain = selectPrincipalChain(cg, { pcgCarbons: chainPrefCarbons }).atoms;
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

    // Add alkyl branch substituents (carbons off-chain not belonging to any group)
    for (let i = 0; i < chain.length; i++) {
      for (const nb of cg.adj.get(chain[i]) ?? []) {
        if (!inChain.has(nb) && !groupAtoms.has(nb)) {
          subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, chain[i]) });
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
