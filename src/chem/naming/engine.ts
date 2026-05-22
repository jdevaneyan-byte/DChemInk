// src/chem/naming/engine.ts
import type { MolGraph, NameResult } from "./graph";
import { buildCarbonGraph, ccOrder, selectPrincipalChain, type CarbonGraph } from "./chain";
import { nameSubstituent } from "./substituent";
import { assembleName, type SuffixKind } from "./assemble";
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

/** Map principal group kind to suffix kind. */
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
