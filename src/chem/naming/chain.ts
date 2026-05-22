// src/chem/naming/chain.ts
import { compareLocants, type MolGraph } from "./graph";
import { nameSubstituent } from "./substituent";

export interface CarbonGraph {
  carbons: number[];                    // carbon atom indices
  adj: Map<number, number[]>;           // carbon -> neighboring carbons
  order: Map<string, 1 | 2 | 3>;        // "min-max" -> C–C bond order
}

function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function buildCarbonGraph(graph: MolGraph): CarbonGraph {
  const carbons = graph.atoms.filter((a) => a.element === "C").map((a) => a.index);
  const isC = new Set(carbons);
  const adj = new Map<number, number[]>();
  const order = new Map<string, 1 | 2 | 3>();
  for (const c of carbons) adj.set(c, []);
  for (const b of graph.bonds) {
    if (isC.has(b.from) && isC.has(b.to)) {
      adj.get(b.from)!.push(b.to);
      adj.get(b.to)!.push(b.from);
      order.set(key(b.from, b.to), b.order);
    }
  }
  return { carbons, adj, order };
}

export function ccOrder(cg: CarbonGraph, a: number, b: number): 1 | 2 | 3 {
  return cg.order.get(key(a, b)) ?? 1;
}

/** Unique path between two carbons in the (acyclic) carbon tree, or null. */
function pathBetween(cg: CarbonGraph, a: number, b: number): number[] | null {
  const parent = new Map<number, number>();
  const seen = new Set<number>([a]);
  const queue = [a];
  while (queue.length) {
    const u = queue.shift()!;
    if (u === b) break;
    for (const v of cg.adj.get(u) ?? []) {
      if (!seen.has(v)) { seen.add(v); parent.set(v, u); queue.push(v); }
    }
  }
  if (!seen.has(b)) return null;
  const path = [b];
  let cur = b;
  while (cur !== a) { cur = parent.get(cur)!; path.push(cur); }
  return path.reverse();
}

/** All maximal-length carbon chains (each as an ordered atom-index array). */
export function longestCarbonChains(cg: CarbonGraph): number[][] {
  const cs = cg.carbons;
  if (cs.length === 1) return [[cs[0]]];
  let best = 0;
  let result: number[][] = [];
  const seenKey = new Set<string>();
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const p = pathBetween(cg, cs[i], cs[j]);
      if (!p) continue;
      if (p.length > best) { best = p.length; result = []; seenKey.clear(); }
      if (p.length === best) {
        const k = [p[0], p[p.length - 1]].sort((x, y) => x - y).join("-");
        if (!seenKey.has(k)) { seenKey.add(k); result.push(p); }
      }
    }
  }
  return result;
}

export interface ChainChoice {
  atoms: number[]; // ordered main-chain atom indices (chosen numbering direction)
}

/** Multiple-bond locant set for a directed path (locant = lower position). */
function multipleBondLocants(path: number[], cg: CarbonGraph): number[] {
  const locs: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (ccOrder(cg, path[i], path[i + 1]) >= 2) locs.push(i + 1);
  }
  return locs;
}

/** Substituent attachment locants for a directed path (ascending). */
function substituentLocants(path: number[], cg: CarbonGraph): number[] {
  const inChain = new Set(path);
  const locs: number[] = [];
  for (let i = 0; i < path.length; i++) {
    for (const nb of cg.adj.get(path[i]) ?? []) {
      if (!inChain.has(nb)) locs.push(i + 1);
    }
  }
  return locs.sort((a, b) => a - b);
}

function countMultipleBonds(path: number[], cg: CarbonGraph): number {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) if (ccOrder(cg, path[i], path[i + 1]) >= 2) n++;
  return n;
}

/** Double-bond-only locant set for a directed path. */
function doubleBondLocants(path: number[], cg: CarbonGraph): number[] {
  const locs: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (ccOrder(cg, path[i], path[i + 1]) === 2) locs.push(i + 1);
  }
  return locs;
}

/** Alphabetization key matching assemble.ts: first letter of the full name. */
function alphaKey(name: string): string {
  return name.replace(/^\((.*)\)$/, "$1").replace(/^[\d,()\-\s]+/, "");
}

/** Ordered (by alphabetical name) substituent locants for a directed path. */
function substituentsByAlpha(path: number[], cg: CarbonGraph): { locant: number; key: string }[] {
  const inChain = new Set(path);
  const out: { locant: number; key: string }[] = [];
  for (let i = 0; i < path.length; i++) {
    for (const nb of cg.adj.get(path[i]) ?? []) {
      if (!inChain.has(nb)) out.push({ locant: i + 1, key: alphaKey(nameSubstituent(cg, nb, path[i])) });
    }
  }
  return out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.locant - y.locant));
}

/**
 * Final alphabetical tie-break: the substituent cited first alphabetically must
 * receive the lower locant. Returns <0 if `path` wins, >0 if `rev` wins, 0 tie.
 */
function compareByFirstAlpha(path: number[], rev: number[], cg: CarbonGraph): number {
  const a = substituentsByAlpha(path, cg);
  const b = substituentsByAlpha(rev, cg);
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i].key !== b[i].key) return a[i].key < b[i].key ? -1 : 1;
    if (a[i].locant !== b[i].locant) return a[i].locant < b[i].locant ? -1 : 1;
  }
  return 0;
}

/** Pick the better numbering direction of one candidate chain. */
function orient(path: number[], cg: CarbonGraph): number[] {
  const rev = [...path].reverse();
  const a = { mb: multipleBondLocants(path, cg), sub: substituentLocants(path, cg) };
  const b = { mb: multipleBondLocants(rev, cg), sub: substituentLocants(rev, cg) };
  // 1. Lower locants to the combined set of multiple bonds.
  const byMb = compareLocants(a.mb, b.mb);
  if (byMb !== 0) return byMb < 0 ? path : rev;
  // 2. Bug 4: on a combined-set tie, double bonds (ene) get the lower locants.
  const byEne = compareLocants(doubleBondLocants(path, cg), doubleBondLocants(rev, cg));
  if (byEne !== 0) return byEne < 0 ? path : rev;
  // 3. Lower locants to the substituent set.
  const bySub = compareLocants(a.sub, b.sub);
  if (bySub !== 0) return bySub < 0 ? path : rev;
  // 4. Bug 3: on a substituent-set tie, the alphabetically-first substituent
  //    gets the lower locant.
  const byAlpha = compareByFirstAlpha(path, rev, cg);
  return byAlpha <= 0 ? path : rev;
}

export function selectPrincipalChain(cg: CarbonGraph): ChainChoice {
  const candidates = longestCarbonChains(cg).map((p) => orient(p, cg));
  candidates.sort((p, q) => {
    const mbCount = countMultipleBonds(q, cg) - countMultipleBonds(p, cg);
    if (mbCount !== 0) return mbCount; // more multiple bonds first
    const mb = compareLocants(multipleBondLocants(p, cg), multipleBondLocants(q, cg));
    if (mb !== 0) return mb;
    const subCount = substituentLocants(q, cg).length - substituentLocants(p, cg).length;
    if (subCount !== 0) return subCount; // more substituents first
    const bySub = compareLocants(substituentLocants(p, cg), substituentLocants(q, cg));
    if (bySub !== 0) return bySub;
    // Final tie-break: prefer the chain giving the alphabetically-first
    // substituent the lower locant.
    return compareByFirstAlpha(p, q, cg);
  });
  return { atoms: candidates[0] };
}
