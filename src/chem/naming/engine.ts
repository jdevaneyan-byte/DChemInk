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

/** Tier-1 acceptance gate. Returns an `unsupported` reason or null if accepted. */
function rejectReason(graph: MolGraph): string | null {
  if (graph.fragmentCount > 1) return "multiple fragments — arrives in a later tier";
  if (graph.atoms.some((a) => a.ringIds.length > 0)) return "contains a ring — arrives in Tier 3";
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
