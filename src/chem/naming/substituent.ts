// src/chem/naming/substituent.ts
import { multiplierPrefix } from "./graph";
import { ccOrder, type CarbonGraph } from "./chain";
import { alkenylYl } from "./assemble";

/**
 * Thrown when a substituent contains unsaturation (or arrangement) that the
 * substituent namer cannot express on its main chain — e.g. an allene, a
 * methylidene (=CH2 branch), or a multiple bond between the chain and a branch.
 * Callers catch this at the top of nameMolecule and DECLINE (no wrong names).
 */
export class UnnameableSubstituent extends Error {
  constructor(msg = "substituent contains unexpressible unsaturation") { super(msg); this.name = "UnnameableSubstituent"; }
}

/** Carbons reachable from `root` without crossing back to `blocked`. */
function subtree(cg: CarbonGraph, root: number, blocked: number): Set<number> {
  const seen = new Set<number>([root]);
  const stack = [root];
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of cg.adj.get(u) ?? []) {
      if (v === blocked || seen.has(v)) continue;
      seen.add(v);
      stack.push(v);
    }
  }
  return seen;
}

/** Longest path within `atoms` that starts at `from`->`start` and goes outward. */
function longestFrom(cg: CarbonGraph, start: number, atoms: Set<number>, blocked: number): number[] {
  let best: number[] = [start];
  const walk = (path: number[], prev: number, node: number) => {
    if (path.length > best.length) best = [...path];
    for (const v of cg.adj.get(node) ?? []) {
      if (v === prev || v === blocked || !atoms.has(v) || path.includes(v)) continue;
      path.push(v);
      walk(path, node, v);
      path.pop();
    }
  };
  walk([start], blocked, start);
  return best;
}

/**
 * Name the substituent rooted at `root`, attached to the parent at `blocked`.
 * Free valence sits on `root`.
 */
export function nameSubstituent(cg: CarbonGraph, root: number, blocked: number): string {
  const atoms = subtree(cg, root, blocked);
  // Parent chain of the substituent: longest chain containing `root`.
  // fromRoot: longest path starting at root going "outward" (away from blocked).
  const fromRoot = longestFrom(cg, root, atoms, blocked);
  // The first step in fromRoot (if any) is fromRoot[1]; other neighbors of root
  // can be used to extend the chain "backwards" through root.
  let chain = fromRoot;
  const forwardFirst = fromRoot.length > 1 ? fromRoot[1] : -1;
  for (const nb of cg.adj.get(root) ?? []) {
    // Skip blocked (parent), skip the direction already taken in fromRoot
    if (nb === blocked || !atoms.has(nb) || nb === forwardFirst) continue;
    // Extend from the "other side" of root
    const branch = longestFrom(cg, nb, atoms, root);
    // chain goes: branch... -> root -> fromRoot[1..]
    const combined = [...[...branch].reverse(), root, ...fromRoot.slice(1)];
    if (combined.length > chain.length) chain = combined;
  }
  // Number so the free valence (root) gets the lowest locant; on a tie (symmetric
  // valence position) give unsaturation the lowest locants — e.g. isopropenyl is
  // prop-1-en-2-yl (ene@1), not prop-2-en-2-yl.
  const fwd = chain;
  const rev = [...chain].reverse();
  const unsatKey = (order: number[]): number[] => {
    const ks: number[] = [];
    for (let i = 0; i < order.length - 1; i++) if (ccOrder(cg, order[i], order[i + 1]) >= 2) ks.push(i + 1);
    return ks.sort((a, b) => a - b);
  };
  const keyOf = (order: number[]): number[] => [order.indexOf(root) + 1, ...unsatKey(order)];
  const kf = keyOf(fwd), kr = keyOf(rev);
  let cmp = 0;
  for (let i = 0; i < Math.max(kf.length, kr.length) && cmp === 0; i++) cmp = (kf[i] ?? 99) - (kr[i] ?? 99);
  const ordered = cmp <= 0 ? fwd : rev;
  const valence = ordered.indexOf(root) + 1;

  const inChain = new Set(ordered);

  // ── ene/yne on the substituent main chain (alkenyl/alkynyl) ─────────────────
  const doubles: number[] = [];
  const triples: number[] = [];
  let onChainMultiples = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const o = ccOrder(cg, ordered[i], ordered[i + 1]);
    if (o === 2) { doubles.push(i + 1); onChainMultiples++; }
    else if (o === 3) { triples.push(i + 1); onChainMultiples++; }
  }
  // Any multiple bond in the subtree that is NOT a consecutive main-chain pair
  // (allene, methylidene/=CH2 branch, chain↔branch double bond) is not
  // expressible → decline the whole molecule.
  let totalMultiples = 0;
  for (const a of atoms) {
    for (const b of cg.adj.get(a) ?? []) {
      if (a < b && atoms.has(b) && ccOrder(cg, a, b) >= 2) totalMultiples++;
    }
  }
  if (totalMultiples !== onChainMultiples) throw new UnnameableSubstituent();

  const subs: { locant: number; name: string }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (const nb of cg.adj.get(ordered[i]) ?? []) {
      if (nb !== blocked && atoms.has(nb) && !inChain.has(nb)) {
        subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, ordered[i]) });
      }
    }
  }
  const base = alkenylYl(ordered.length, valence, doubles, triples);
  if (subs.length === 0) return base;
  // e.g. "2-methyl" + "propyl" = "2-methylpropyl" (no separator before parent yl)
  return prefixFor(subs) + base;
}

/** Build an alphanumeric, multiplied prefix string from sub-substituents. */
function prefixFor(subs: { locant: number; name: string }[]): string {
  const groups = new Map<string, number[]>();
  for (const s of subs) (groups.get(s.name) ?? groups.set(s.name, []).get(s.name)!).push(s.locant);
  const parts = [...groups.entries()].map(([name, locants]) => ({
    name, locants: locants.sort((a, b) => a - b),
  }));
  parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // Substituent groups joined by hyphens; parent name appended directly (no trailing dash).
  return parts
    .map((p) => `${p.locants.join(",")}-${multiplierPrefix(p.locants.length)}${p.name}`)
    .join("-");
}
