// src/chem/naming/substituent.ts
import { parentStem, multiplierPrefix } from "./graph";
import { type CarbonGraph } from "./chain";

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
  // Number so the free valence (root) gets the lowest locant.
  const fwd = chain;
  const rev = [...chain].reverse();
  const valFwd = fwd.indexOf(root) + 1;
  const valRev = rev.indexOf(root) + 1;
  const ordered = valFwd <= valRev ? fwd : rev;
  const valence = ordered.indexOf(root) + 1;

  const inChain = new Set(ordered);
  const subs: { locant: number; name: string }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (const nb of cg.adj.get(ordered[i]) ?? []) {
      if (nb !== blocked && atoms.has(nb) && !inChain.has(nb)) {
        subs.push({ locant: i + 1, name: nameSubstituent(cg, nb, ordered[i]) });
      }
    }
  }
  const stem = parentStem(ordered.length);
  // Use simple "stem+yl" form when free valence is at position 1;
  // use "stemanN-yl" form only when the valence is at an interior/terminal position > 1.
  const base = valence === 1 ? `${stem}yl` : `${stem}an-${valence}-yl`;
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
