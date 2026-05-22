// src/chem/naming/engine.ts
import type { MolGraph, NameResult } from "./graph";
import { buildCarbonGraph, ccOrder, selectPrincipalChain } from "./chain";
import { nameSubstituent } from "./substituent";
import { assembleName } from "./assemble";

const ELEMENT_REASON: Record<string, string> = {
  O: "contains oxygen — functional groups arrive in Tier 2",
  N: "contains nitrogen — functional groups arrive in Tier 2",
  S: "contains sulfur — Tier 2+",
};

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

/** Tier-1 acceptance gate. Returns an `unsupported` reason or null if accepted. */
function rejectReason(graph: MolGraph): string | null {
  if (graph.fragmentCount > 1) return "multiple fragments — arrives in a later tier";
  if (graph.atoms.some((a) => a.ringIds.length > 0)) return "contains a ring — arrives in Tier 3";
  // Defense-in-depth: even without ring metadata, a connected heavy-atom graph
  // with as many (or more) bonds as atoms must contain a cycle (a tree has
  // atoms-1 bonds). Reject so we never emit an acyclic name for a ring.
  if (hasHeavyAtomCycle(graph)) return "contains a ring — arrives in Tier 3";
  if (graph.atoms.some((a) => a.charge !== 0)) return "contains a charged atom — later tier";
  for (const a of graph.atoms) {
    if (a.element !== "C" && a.element !== "H") {
      return ELEMENT_REASON[a.element] ?? `contains ${a.element} — later tier`;
    }
  }
  return null;
}

export function nameMolecule(graph: MolGraph): NameResult {
  const heavy = graph.atoms.filter((a) => a.element !== "H");
  if (heavy.length === 0) return { name: null, status: "empty" };

  const reason = rejectReason(graph);
  if (reason) return { name: null, status: "unsupported", reason };

  try {
    const cg = buildCarbonGraph(graph);
    const chain = selectPrincipalChain(cg).atoms;

    const doubles: number[] = [];
    const triples: number[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const o = ccOrder(cg, chain[i], chain[i + 1]);
      if (o === 2) doubles.push(i + 1);
      if (o === 3) triples.push(i + 1);
    }

    const inChain = new Set(chain);
    const subs: { locant: number; name: string }[] = [];
    for (let i = 0; i < chain.length; i++) {
      for (const nb of cg.adj.get(chain[i]) ?? []) {
        if (!inChain.has(nb)) subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, chain[i]) });
      }
    }

    const name = assembleName({ chainLen: chain.length, doubles, triples, subs });
    return { name, status: "named", parentChain: chain };
  } catch (e) {
    return { name: null, status: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}
