// src/chem/naming/ring.ts
// Task 1: single-ring perception + canonical ring fingerprint (pure TS, no RDKit)
// Task 2: ring tables (carbocycle / benzene / heterocycle) + numbering
// Task T4S2: multi-ring perception (perceiveRingSystem) + polycyclic fingerprint + curated fused table
import type { MolGraph } from "./graph";

// ────────────────────────────────────────────────────────────────────────────────
// T4 Stage 0: Multi-ring system perception + classification
// ────────────────────────────────────────────────────────────────────────────────

export type RingSystemKind = "mono" | "fused" | "spiro" | "bridged" | "assembly" | "other";

export interface RingSystemInfo {
  /** Number of SSSR rings */
  ringCount: number;
  /** Classification of the overall ring system */
  kind: RingSystemKind;
  /** All ring atom indices (union of all SSSR rings) */
  atoms: Set<number>;
  /** All ring bond pairs (both directions; from < to) */
  bonds: Set<string>;
  /** Each SSSR ring as array of atom indices */
  rings: number[][];
}

/**
 * Perceive all SSSR rings from atom.ringIds and classify the ring system.
 *
 * Classification rules (for all rings considered together):
 *   mono     – exactly 1 ring
 *   fused    – 2+ rings, every pair of adjacent rings shares exactly 2 atoms AND
 *              those 2 atoms are joined by a bond (ortho-fused)
 *   spiro    – 2+ rings; at least one pair shares exactly 1 atom
 *   bridged  – 2+ rings; at least one pair shares exactly 2 atoms NOT bonded
 *   assembly – 2+ rings; no atoms shared between any rings (disjoint)
 *   other    – anything else (e.g. 3+ atoms shared, or peri-fused)
 */
export function perceiveRingSystem(graph: MolGraph): RingSystemInfo {
  // Collect SSSR rings from atom.ringIds
  const ringAtomLists = new Map<number, number[]>();
  for (const a of graph.atoms) {
    for (const rid of a.ringIds) {
      if (!ringAtomLists.has(rid)) ringAtomLists.set(rid, []);
      ringAtomLists.get(rid)!.push(a.index);
    }
  }

  const rings = [...ringAtomLists.values()];
  const ringCount = rings.length;

  // Build bond index for quick lookup
  const bondSet = new Set<string>();
  for (const b of graph.bonds) {
    const lo = Math.min(b.from, b.to);
    const hi = Math.max(b.from, b.to);
    bondSet.add(`${lo},${hi}`);
  }
  const hasBond = (a: number, b: number): boolean => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return bondSet.has(`${lo},${hi}`);
  };

  // Union of all ring atoms
  const allAtoms = new Set<number>();
  for (const r of rings) for (const a of r) allAtoms.add(a);

  // Build ring bond set (for adjacency queries)
  const allRingBonds = new Set<string>();
  for (const a of allAtoms) {
    for (const b of graph.bonds) {
      if ((b.from === a || b.to === a) && allAtoms.has(b.from) && allAtoms.has(b.to)) {
        const lo = Math.min(b.from, b.to);
        const hi = Math.max(b.from, b.to);
        allRingBonds.add(`${lo},${hi}`);
      }
    }
  }

  if (ringCount === 0) {
    return { ringCount: 0, kind: "mono", atoms: new Set(), bonds: new Set(), rings: [] };
  }
  if (ringCount === 1) {
    return { ringCount: 1, kind: "mono", atoms: allAtoms, bonds: allRingBonds, rings };
  }

  // For 2+ rings: examine all pairs
  // Build atom sets for each ring
  const ringSets = rings.map(r => new Set(r));

  let hasSpiro = false;
  let hasBridged = false;
  let hasOther = false;

  // Ring adjacency: ring i and ring j are "adjacent" if they share any atoms.
  // Used to determine if the ring system is connected (not a disjoint assembly).
  const ringNeighbors: Set<number>[] = rings.map(() => new Set<number>());

  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const shared: number[] = [];
      for (const a of ringSets[i]) {
        if (ringSets[j].has(a)) shared.push(a);
      }
      if (shared.length === 0) {
        // Disjoint pair: not adjacent in ring graph; check later if whole system is disconnected
      } else if (shared.length === 1) {
        hasSpiro = true;
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      } else if (shared.length === 2) {
        // Two shared atoms: ortho-fused if bonded, bridged otherwise
        if (!hasBond(shared[0], shared[1])) {
          hasBridged = true;
        }
        // (ortho-fused case: no flag needed — kind defaults to "fused" when no other flags set)
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      } else if (shared.length === 3) {
        // 3 shared atoms in SSSR rings: this is a bicyclo bridged system
        // e.g. norbornane: two SSSR rings sharing a one-atom bridge + two bridgeheads
        hasBridged = true;
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      } else {
        // 4+ shared atoms: complex topology
        hasOther = true;
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      }
    }
  }

  // Check if the ring system is connected (all rings reachable from ring 0)
  const ringVisited = new Set<number>([0]);
  const ringQueue = [0];
  while (ringQueue.length > 0) {
    const cur = ringQueue.shift()!;
    for (const nb of ringNeighbors[cur]) {
      if (!ringVisited.has(nb)) {
        ringVisited.add(nb);
        ringQueue.push(nb);
      }
    }
  }
  const isDisconnectedAssembly = ringVisited.size < rings.length;

  let kind: RingSystemKind;
  if (hasOther) {
    kind = "other";
  } else if (hasSpiro) {
    kind = "spiro";
  } else if (hasBridged) {
    kind = "bridged";
  } else if (isDisconnectedAssembly) {
    // The rings form disconnected components (e.g. biphenyl: two separate benzene rings)
    kind = "assembly";
  } else {
    // All rings are connected via shared atoms/bonds → fused (ortho-fused for our purposes)
    kind = "fused";
  }

  return { ringCount, kind, atoms: allAtoms, bonds: allRingBonds, rings };
}

// ────────────────────────────────────────────────────────────────────────────────
// Task 1: Ring perception
// ────────────────────────────────────────────────────────────────────────────────

export interface RingInfo {
  atoms: number[];       // ring atom indices in cyclic order
  size: number;
  aromatic: boolean;     // true when every ring bond is aromatic
  heteroatoms: number[]; // ring atom indices that are not carbon
}

/**
 * Perceive the single ring in a MolGraph.
 * Returns null when there are zero or ≥2 rings (or SSSR says so).
 *
 * Algorithm:
 *  1. Collect all atoms that belong to at least one ring (ringIds.length > 0).
 *  2. If none → null. If >1 distinct SSSR ring id used → null (multi-ring).
 *  3. Walk the ring bonds to produce a cyclic atom ordering.
 *  4. Detect aromaticity from bond flags.
 */
export function perceiveRing(graph: MolGraph): RingInfo | null {
  // Gather distinct ring ids used across all atoms
  const distinctRingIds = new Set<number>();
  for (const a of graph.atoms) {
    for (const r of a.ringIds) distinctRingIds.add(r);
  }

  // 0 rings → null
  if (distinctRingIds.size === 0) return null;
  // ≥2 rings → multi-ring → null  (Tier 4)
  if (distinctRingIds.size > 1) return null;

  // Exactly 1 SSSR ring. Collect its member atom indices.
  const ringAtomIndices = new Set<number>();
  for (const a of graph.atoms) {
    if (a.ringIds.length > 0) ringAtomIndices.add(a.index);
  }

  // Build adjacency restricted to ring atoms ↔ ring bonds
  const ringAdj = new Map<number, number[]>();
  for (const idx of ringAtomIndices) ringAdj.set(idx, []);

  const ringBonds: { from: number; to: number; aromatic: boolean }[] = [];
  for (const b of graph.bonds) {
    if (ringAtomIndices.has(b.from) && ringAtomIndices.has(b.to)) {
      ringAdj.get(b.from)!.push(b.to);
      ringAdj.get(b.to)!.push(b.from);
      ringBonds.push({ from: b.from, to: b.to, aromatic: b.aromatic });
    }
  }

  // Walk cycle to get atoms in cyclic order
  const cycleAtoms = walkCycle(ringAdj, ringAtomIndices);
  if (!cycleAtoms) return null;

  // Aromaticity: RDKit emits Kekulé bonds (order 1/2), not aromatic (bo=12), for
  // aromatic rings in CommonChem JSON. Detect aromaticity by checking if the ring
  // has alternating single/double bonds consistent with a conjugated π system.
  // For a ring of size n, Kekulé aromaticity = floor(n/2) double bonds in the ring.
  // Additionally verify no sp3-consistent H count (every ring C should have ≤1 H).
  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));
  const ringDoubleBonds = ringBonds.filter((b) => {
    // Find the actual bond order from graph.bonds
    const bond = graph.bonds.find(
      (gb) => (gb.from === b.from && gb.to === b.to) || (gb.from === b.to && gb.to === b.from),
    );
    return bond && bond.order === 2;
  });
  const n2 = cycleAtoms.length;
  const expectedDoubleBonds = Math.floor(n2 / 2);
  // For a 5-membered ring with one heteroatom (furan/pyrrole/thiophene): 2 double bonds
  // For benzene/pyridine (6-membered): 3 double bonds
  // Check: # double bonds == floor(n/2) AND every non-heteroatom ring atom has exactly 1 H
  // (which distinguishes sp2 from sp3 ring atoms)
  const allSp2 = cycleAtoms.every((idx) => {
    const a = atomById.get(idx);
    if (!a) return false;
    // sp2 ring atoms: C has 0 or 1 H (not 2); N in pyridine has 0 H; pyrrole N has 1 H (max)
    // sp3 ring atoms: C has 2 H; N in piperidine has 1 H but also contributes to saturation
    // We distinguish pyrrole-N (aromatic, 1H) vs piperidine-N (sp3, 1H) by double-bond count
    if (a.element === "C") return a.hydrogens <= 1;
    // N in aromatic rings: pyridine-type N has 0 H; pyrrole-type N has 1 H (lone pair in ring)
    // piperidine N (sp3) also has 1 H — must distinguish by checking double bonds
    if (a.element === "N") return a.hydrogens <= 1; // both pyridine-N and pyrrole-N qualify
    if (a.element === "O") return a.hydrogens === 0; // aromatic O (furan) has 0 H
    if (a.element === "S") return a.hydrogens === 0; // aromatic S (thiophene) has 0 H
    return true;
  });
  const aromatic = ringDoubleBonds.length === expectedDoubleBonds && allSp2;

  // Heteroatoms
  const heteroatoms = cycleAtoms.filter((idx) => {
    const a = atomById.get(idx);
    return a && a.element !== "C";
  });

  return {
    atoms: cycleAtoms,
    size: cycleAtoms.length,
    aromatic,
    heteroatoms,
  };
}

/** Walk the ring adjacency to produce atoms in cyclic order. */
function walkCycle(
  adj: Map<number, number[]>,
  atomSet: Set<number>,
): number[] | null {
  if (atomSet.size === 0) return null;
  const start = [...atomSet][0];
  const path: number[] = [start];
  const visited = new Set<number>([start]);
  let current = start;
  let prev = -1;

  for (let step = 0; step < atomSet.size - 1; step++) {
    const neighbors = (adj.get(current) ?? []).filter(
      (n) => n !== prev && atomSet.has(n),
    );
    // In a cycle each ring atom has exactly 2 ring neighbors
    // Pick the unvisited neighbor (or if all visited, the one not prev)
    const next = neighbors.find((n) => !visited.has(n));
    if (!next) return null; // shouldn't happen for a simple cycle
    path.push(next);
    visited.add(next);
    prev = current;
    current = next;
  }

  // Verify closure: last atom connects back to start
  if (!(adj.get(current) ?? []).includes(start)) return null;

  return path;
}

// ────────────────────────────────────────────────────────────────────────────────
// Ring fingerprint (canonical, rotation/reflection invariant, substituents ignored)
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Build a canonical ring fingerprint from the ring's atoms and bonds only
 * (substituents are ignored). The fingerprint is the lexicographically smallest
 * string among all rotations and both directions of the per-atom
 * "(element,aromatic)" tuple interleaved with bond-order values.
 *
 * For aromatic rings (ring.aromatic=true), all ring bond orders are normalized
 * to "ar" to avoid Kekulé-variant sensitivity. For non-aromatic rings, actual
 * bond orders (1/2/3) are used.
 *
 * Format: atom0:bond01:atom1:bond12:…:atomN-1:bondN-1,0
 * where each atom token = "element,aroBit" and bond token = "1"/"2"/"3"/"ar".
 */
export function ringFingerprint(graph: MolGraph, ring: RingInfo): string {
  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));

  // Per-atom tokens: "Element,aromaticBit"
  // Use derived ring.aromatic (not atom.aromatic which is always false from adapter)
  const aroBit = ring.aromatic ? 1 : 0;
  const atomToken = (idx: number): string => {
    const a = atomById.get(idx)!;
    return `${a.element},${aroBit}`;
  };

  // Bond token between two ring atoms
  const bondToken = (a: number, b: number): string => {
    if (ring.aromatic) return "ar"; // normalize all ring bonds for aromatic rings
    for (const bond of graph.bonds) {
      if ((bond.from === a && bond.to === b) || (bond.from === b && bond.to === a)) {
        return String(bond.order);
      }
    }
    return "1";
  };

  const n = ring.size;
  const atoms = ring.atoms;

  // Build atom tokens and bond tokens in the ring's current cyclic order
  const atomTokens = atoms.map(atomToken);
  // bondTokens[i] = bond between atoms[i] and atoms[(i+1)%n]
  const bondTokensFwd = atoms.map((a, i) => bondToken(a, atoms[(i + 1) % n]));
  // For reverse direction: bondTokens[i] = bond between atoms[i] and atoms[(i-1+n)%n]
  // which is the same physical bond as bondTokensFwd[(i-1+n)%n]

  // Generate all rotations × 2 directions and pick lexicographically smallest
  let best: string | null = null;
  for (let start = 0; start < n; start++) {
    // Forward direction: atoms[start], atoms[start+1], ..., atoms[start+n-1]
    {
      const segments: string[] = [];
      for (let i = 0; i < n; i++) {
        const pos = (start + i) % n;
        segments.push(atomTokens[pos]);
        // Bond from atoms[pos] to atoms[(pos+1)%n]
        segments.push(bondTokensFwd[pos]);
      }
      const candidate = segments.join(":");
      if (best === null || candidate < best) best = candidate;
    }
    // Reverse direction: atoms[start], atoms[start-1], ..., atoms[start-n+1]
    {
      const segments: string[] = [];
      for (let i = 0; i < n; i++) {
        const pos = ((start - i) % n + n) % n;
        segments.push(atomTokens[pos]);
        // Bond from atoms[pos] to atoms[(pos-1+n)%n], which is bondTokensFwd[(pos-1+n)%n]
        segments.push(bondTokensFwd[((pos - 1) % n + n) % n]);
      }
      const candidate = segments.join(":");
      if (best === null || candidate < best) best = candidate;
    }
  }
  return best!;
}

// ────────────────────────────────────────────────────────────────────────────────
// Task 2: Ring tables + numbering
// ────────────────────────────────────────────────────────────────────────────────

export interface RingNaming {
  parent: string;                   // "cyclohexane" | "benzene" | "pyridine" | retained
  locantOf: Map<number, number>;    // ring atom index → IUPAC locant
  kind: "carbocycle" | "benzene" | "heterocycle";
  retainedAromatic?: string;        // when a retained benzene parent applies
}

// ── Carbocycle stems ──────────────────────────────────────────────────────────

const CYCLO_STEMS: Record<number, string> = {
  3: "cyclopropane",
  4: "cyclobutane",
  5: "cyclopentane",
  6: "cyclohexane",
  7: "cycloheptane",
  8: "cyclooctane",
  9: "cyclononane",
  10: "cyclodecane",
};

// ── Heterocycle table ─────────────────────────────────────────────────────────
// Each entry maps a ring fingerprint → { name, locant assignment }
// locantOf: given the ring atoms in the canonical fingerprint's atom order (rotation 0),
// we store the atom-token-to-locant assignment as a function of how to assign
// locants to the ring atoms returned by perceiveRing.
//
// Rather than storing fingerprints literally (which depend on atom ordering),
// we store the defining ring composition and aromaticity, then match
// using element multisets + aromaticity.

interface HeteroEntry {
  /** Retained IUPAC name */
  name: string;
  /** Ring size */
  size: number;
  /** Aromaticity */
  aromatic: boolean;
  /**
   * Element sequence of the ring in the IUPAC-canonical atom order (heteroatom(s)
   * first). Length = size. Used together with the ring fingerprint for matching.
   * We store multiple valid starting sequences (for rings with multiple heteroatoms
   * in different positions).
   */
  elementSeqs: string[][];
  /**
   * Locant assignment in the IUPAC convention: the atom at elementSeqs[0][0]
   * gets locant 1, elementSeqs[0][1] gets locant 2, etc.
   * (All elementSeqs share the same locant logic, since they're rotations of each other.)
   */
}

// Aromatic heterocycles
// pyridine: N at position 1 in a 6-membered aromatic ring
const HETERO_TABLE: HeteroEntry[] = [
  // ── Aromatic 6-membered (one N) ──
  {
    name: "pyridine",
    size: 6,
    aromatic: true,
    elementSeqs: [["N", "C", "C", "C", "C", "C"]],
  },
  // ── Aromatic 6-membered (two N) ──
  {
    name: "pyrimidine",
    size: 6,
    aromatic: true,
    // N at 1,3: N-C-N-C-C-C
    elementSeqs: [["N", "C", "N", "C", "C", "C"]],
  },
  {
    name: "pyrazine",
    size: 6,
    aromatic: true,
    // N at 1,4: N-C-C-N-C-C
    elementSeqs: [["N", "C", "C", "N", "C", "C"]],
  },
  {
    name: "pyridazine",
    size: 6,
    aromatic: true,
    // N at 1,2: N-N-C-C-C-C
    elementSeqs: [["N", "N", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (one O) ──
  {
    name: "furan",
    size: 5,
    aromatic: true,
    elementSeqs: [["O", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (one S) ──
  {
    name: "thiophene",
    size: 5,
    aromatic: true,
    elementSeqs: [["S", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (one N) ──
  {
    name: "pyrrole",
    size: 5,
    aromatic: true,
    elementSeqs: [["N", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (N at 1 + N at 3 = imidazole) ──
  {
    name: "imidazole",
    size: 5,
    aromatic: true,
    // IUPAC numbering: N(1)-C-N(3)-C-C  [1,3-N arrangement]
    elementSeqs: [["N", "C", "N", "C", "C"]],
  },
  // ── Aromatic 5-membered (N at 1 + N at 2 = pyrazole) ──
  {
    name: "pyrazole",
    size: 5,
    aromatic: true,
    // N(1)-N(2)-C-C-C
    elementSeqs: [["N", "N", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (O at 1 + N at 3 = oxazole) ──
  {
    name: "oxazole",
    size: 5,
    aromatic: true,
    // O(1)-C-N(3)-C-C
    elementSeqs: [["O", "C", "N", "C", "C"]],
  },
  // ── Aromatic 5-membered (O at 1 + N at 2 = isoxazole) ──
  {
    name: "isoxazole",
    size: 5,
    aromatic: true,
    // O(1)-N(2)-C-C-C
    elementSeqs: [["O", "N", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (S at 1 + N at 3 = thiazole) ──
  {
    name: "thiazole",
    size: 5,
    aromatic: true,
    // S(1)-C-N(3)-C-C
    elementSeqs: [["S", "C", "N", "C", "C"]],
  },
  // ── Mancude 6-membered (O) = pyran — used for 2H-pyran-2-one parent lookup ──
  // "Pyran" itself is not a stable aromatic compound but the aromatic fingerprint
  // [O,ar,C,ar,...] is used in nameAromaticRingCarbonyl for pyranone naming.
  // We store it with aromatic=true so the forced-aromatic ring lookup finds it.
  {
    name: "pyran",
    size: 6,
    aromatic: true,
    elementSeqs: [["O", "C", "C", "C", "C", "C"]],
  },

  // ── Saturated 3-membered ──
  {
    name: "aziridine",
    size: 3,
    aromatic: false,
    elementSeqs: [["N", "C", "C"]],
  },
  {
    name: "oxirane",
    size: 3,
    aromatic: false,
    elementSeqs: [["O", "C", "C"]],
  },
  // ── Saturated 4-membered ──
  {
    name: "azetidine",
    size: 4,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C"]],
  },
  // ── Saturated 5-membered (one N) ──
  {
    name: "pyrrolidine",
    size: 5,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C", "C"]],
  },
  // ── Saturated 5-membered (one O) = oxolane (tetrahydrofuran) ──
  {
    name: "oxolane",
    size: 5,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C", "C"]],
  },
  // ── Saturated 5-membered (one S) = thiolane ──
  {
    name: "thiolane",
    size: 5,
    aromatic: false,
    elementSeqs: [["S", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (one N) ──
  {
    name: "piperidine",
    size: 6,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (one O) = oxane (tetrahydropyran) ──
  {
    name: "oxane",
    size: 6,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (one S) = thiane ──
  {
    name: "thiane",
    size: 6,
    aromatic: false,
    elementSeqs: [["S", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (N + O at 1,4) = morpholine ──
  {
    name: "morpholine",
    size: 6,
    aromatic: false,
    // O(1)-C-N(3)... wait — morpholine: O at 1, N at 4: O-C-C-N-C-C
    elementSeqs: [["O", "C", "C", "N", "C", "C"]],
  },
  // ── Saturated 6-membered (N + N at 1,4) = piperazine ──
  {
    name: "piperazine",
    size: 6,
    aromatic: false,
    // N at 1 and 4: N-C-C-N-C-C
    elementSeqs: [["N", "C", "C", "N", "C", "C"]],
  },
  // ── Saturated 4-membered (one O) = oxetane ──
  {
    name: "oxetane",
    size: 4,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C"]],
  },
  // ── Saturated 7-membered (one N) = azepane ──
  {
    name: "azepane",
    size: 7,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 7-membered (one O) = oxepane ──
  {
    name: "oxepane",
    size: 7,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C", "C", "C", "C"]],
  },
];

/**
 * Given the ring's element sequence (in cyclic order) and aromaticity,
 * find the matching heterocycle entry if any.
 * Returns { entry, startIdx, forward } where startIdx is the index in
 * ring.atoms where locant 1 is assigned, and forward is the direction.
 */
function matchHeterocycle(
  ring: RingInfo,
  graph: MolGraph,
): { entry: HeteroEntry; startIdx: number; forward: boolean } | null {
  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));
  const n = ring.size;
  const elements = ring.atoms.map((idx) => atomById.get(idx)!.element);

  for (const entry of HETERO_TABLE) {
    if (entry.size !== n || entry.aromatic !== ring.aromatic) continue;

    // Try to match any elementSeq against the ring (rotations + both directions)
    for (const seq of entry.elementSeqs) {
      // Try all starting positions and both directions
      for (let start = 0; start < n; start++) {
        for (const fwd of [true, false]) {
          let matches = true;
          for (let i = 0; i < n; i++) {
            const pos = fwd
              ? (start + i) % n
              : ((start - i) % n + n) % n;
            if (elements[pos] !== seq[i]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            return { entry, startIdx: start, forward: fwd };
          }
        }
      }
    }
  }
  return null;
}

/**
 * For a carbocycle (no heteroatoms), assign ring atom → IUPAC locant
 * minimizing the locant set for: PCG carbons > double-bond locants > substituent locants.
 * Returns a map from ring atom index → locant.
 *
 * opts.pcgAtoms: set of ring atom indices that carry the PCG
 * opts.unsatBonds: pairs [a,b] of ring atom indices that are double/triple bonds
 * opts.subAtoms: set of ring atom indices that have substituents
 * opts.subAlphaKeys: map ring atom index → alphabetization key of its substituent
 *   (used for the final IUPAC tie-break: alphabetically-first substituent gets lowest locant)
 */
function assignCarbocycleLocants(
  ring: RingInfo,
  opts: {
    pcgAtoms?: Set<number>;
    unsatBonds?: [number, number][];
    subAtoms?: Set<number>;
    subAlphaKeys?: Map<number, string>;
  } = {},
): Map<number, number> {
  const n = ring.size;
  const { pcgAtoms, unsatBonds = [], subAtoms, subAlphaKeys } = opts;

  // We try all starting positions and both directions, pick best by priority ladder
  let bestMap: Map<number, number> | null = null;
  let bestPcg: number[] = [];
  let bestUnsat: number[] = [];
  let bestSub: number[] = [];

  for (let start = 0; start < n; start++) {
    for (const fwd of [true, false]) {
      // Build locantOf map for this orientation
      const locantOf = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const pos = fwd ? (start + i) % n : ((start - i) % n + n) % n;
        locantOf.set(ring.atoms[pos], i + 1);
      }

      // Compute priority arrays
      const pcgLocs: number[] = [];
      if (pcgAtoms) {
        for (const [atomIdx, loc] of locantOf) {
          if (pcgAtoms.has(atomIdx)) pcgLocs.push(loc);
        }
        pcgLocs.sort((a, b) => a - b);
      }

      const unsatLocs: number[] = [];
      for (const [a, b] of unsatBonds) {
        const la = locantOf.get(a)!;
        const lb = locantOf.get(b)!;
        // For ring double bonds: the locant is min(la, lb) EXCEPT when the bond
        // spans the ring-closing position {1, n} (wrap-around bond). In that case
        // the locant is n, per IUPAC convention (the "n-ene" bond, not "1-ene").
        // This prevents, e.g., cyclohexa-1,4-diene from being mislabelled 1,3-diene
        // via a backward walk that wraps the 1,4-bond across the ring closure.
        const lo = Math.min(la, lb);
        const hi = Math.max(la, lb);
        const isWrapAround = lo === 1 && hi === n;
        unsatLocs.push(isWrapAround ? n : lo);
      }
      unsatLocs.sort((a, b) => a - b);

      const subLocs: number[] = [];
      if (subAtoms) {
        for (const [atomIdx, loc] of locantOf) {
          if (subAtoms.has(atomIdx)) subLocs.push(loc);
        }
        subLocs.sort((a, b) => a - b);
      }

      // Compare to best
      if (!bestMap) {
        bestMap = locantOf;
        bestPcg = pcgLocs;
        bestUnsat = unsatLocs;
        bestSub = subLocs;
        continue;
      }

      // Priority: PCG first
      if (pcgAtoms && pcgAtoms.size > 0) {
        const cmp = compareArr(pcgLocs, bestPcg);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
          continue;
        } else if (cmp > 0) {
          continue;
        }
      }
      // Then unsaturation
      {
        const cmp = compareArr(unsatLocs, bestUnsat);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
          continue;
        } else if (cmp > 0) {
          continue;
        }
      }
      // Then substituents
      if (subAtoms && subAtoms.size > 0) {
        const cmp = compareArr(subLocs, bestSub);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
          continue;
        } else if (cmp > 0) {
          continue;
        }
      }

      // Alphabetical tie-break: the substituent cited first alphabetically gets
      // the lowest locant. Build a list of (alphaKey, locant) pairs sorted by key,
      // then compare locants in that alpha-sorted order.
      if (subAlphaKeys && subAlphaKeys.size > 0 && bestMap) {
        const cmp = compareByAlphaLocant(locantOf, bestMap, subAlphaKeys);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
        }
        // cmp >= 0: keep bestMap
      }
    }
  }

  return bestMap ?? new Map(ring.atoms.map((a, i) => [a, i + 1]));
}

function compareArr(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Alphabetical tie-break for ring numbering (IUPAC P-14.5):
 * When two orientations give the same locant set for substituents, the one where
 * the alphabetically-first substituent has the lower locant wins.
 *
 * Returns <0 if `candidate` wins over `current`, >0 if `current` wins, 0 if tied.
 */
function compareByAlphaLocant(
  candidate: Map<number, number>,
  current: Map<number, number>,
  subAlphaKeys: Map<number, string>,
): number {
  // Build sorted-by-alpha list of (key, locant) for each orientation
  function alphaLocants(locantOf: Map<number, number>): { key: string; locant: number }[] {
    const pairs: { key: string; locant: number }[] = [];
    for (const [atomIdx, alphaKey] of subAlphaKeys) {
      const loc = locantOf.get(atomIdx);
      if (loc !== undefined) pairs.push({ key: alphaKey, locant: loc });
    }
    // Sort by alpha key first, then by locant (to make comparison stable)
    pairs.sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : x.locant - y.locant);
    return pairs;
  }

  const aCand = alphaLocants(candidate);
  const aCurr = alphaLocants(current);
  const len = Math.min(aCand.length, aCurr.length);
  for (let i = 0; i < len; i++) {
    // Same alpha key at position i: compare locants (lower is better)
    if (aCand[i].key === aCurr[i].key) {
      if (aCand[i].locant !== aCurr[i].locant) {
        return aCand[i].locant - aCurr[i].locant;
      }
    }
  }
  return 0;
}

/**
 * Name the ring (carbocycle, benzene, or heterocycle) and return numbering.
 * Returns null for unsupported rings (non-tabled heterocycles, rings outside size range).
 */
export function nameRing(
  graph: MolGraph,
  ring: RingInfo,
  opts: {
    pcgAtoms?: Set<number>;
    unsatBonds?: [number, number][];
    subAtoms?: Set<number>;
    /** Map: ring atom index → alphabetization key of its substituent name.
     *  Used for the final IUPAC tie-break (alphabetically-first substituent
     *  gets the lowest locant). Only needed for carbocycles/benzene. */
    subAlphaKeys?: Map<number, string>;
  } = {},
): RingNaming | null {
  // ── Benzene (aromatic all-carbon 6-membered) ──────────────────────────────────
  if (ring.aromatic && ring.heteroatoms.length === 0 && ring.size === 6) {
    // Benzene: aromatic ring gets simple sequential locants, orientation chosen
    // to minimize PCG/substituent locants.
    const locantOf = assignCarbocycleLocants(ring, opts);
    return { parent: "benzene", locantOf, kind: "benzene" };
  }

  // ── Carbocycle (non-aromatic all-carbon) ─────────────────────────────────────
  if (ring.heteroatoms.length === 0 && !ring.aromatic) {
    const stem = CYCLO_STEMS[ring.size];
    if (!stem) return null; // size not in table (e.g. 11-membered) → Tier 4
    const locantOf = assignCarbocycleLocants(ring, opts);
    return { parent: stem, locantOf, kind: "carbocycle" };
  }

  // ── Heterocycle (match against table) ─────────────────────────────────────────
  if (ring.heteroatoms.length > 0) {
    const match = matchHeterocycle(ring, graph);
    if (!match) return null; // not in table → Tier 4

    const { entry, startIdx, forward } = match;
    const n = ring.size;

    // Build locantOf from the matched orientation
    // The IUPAC canonical numbering has locant 1 at startIdx in the forward direction
    // But we must also consider which direction minimizes PCG/substituent locants.
    // First build the "base" locant map from the matched heterocycle orientation:
    const baseLocantOf = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const pos = forward ? (startIdx + i) % n : ((startIdx - i) % n + n) % n;
      baseLocantOf.set(ring.atoms[pos], i + 1);
    }

    // For heterocycles with a unique heteroatom position (single heteroatom
    // or asymmetric arrangement), the IUPAC numbering is fixed (heteroatom = 1).
    // For symmetric cases, we need to choose the direction that minimises
    // PCG/substituent locants while keeping the heteroatom at locant 1.

    // Try both directions from the same startIdx, keeping heteroatom at 1
    // (i.e., try startIdx in forward and startIdx in reverse if the heteroatom
    // is still at locant 1 — which it is by definition, since it's the starting point).
    // Actually, the match already gives us one valid orientation.
    // We must also try the "clockwise" vs "counterclockwise" from startIdx:
    // Both assign locant 1 to the heteroatom, but differ in which way locants increase.

    const candidateMaps: Map<number, number>[] = [];
    // Try startIdx forward:
    {
      const m = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        m.set(ring.atoms[(startIdx + i) % n], i + 1);
      }
      candidateMaps.push(m);
    }
    // Try startIdx backward:
    {
      const m = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        m.set(ring.atoms[((startIdx - i) % n + n) % n], i + 1);
      }
      candidateMaps.push(m);
    }

    // For heterocycles with two heteroatoms (like pyrimidine, pyrazine, etc.),
    // there may be multiple starting positions that give the heteroatoms the lowest
    // locants. We already have the primary match; also try all rotations where
    // the element sequence matches.
    const allMatchedMaps: Map<number, number>[] = [...candidateMaps];

    // For multi-heteroatom cases, try other valid start positions that also match
    // the element sequence
    for (const seq of entry.elementSeqs) {
      const elements = ring.atoms.map((idx) => {
        const a = graph.atoms.find((atom) => atom.index === idx);
        return a?.element ?? "C";
      });
      for (let altStart = 0; altStart < n; altStart++) {
        for (const altFwd of [true, false]) {
          let matches = true;
          for (let i = 0; i < n; i++) {
            const pos = altFwd ? (altStart + i) % n : ((altStart - i) % n + n) % n;
            if (elements[pos] !== seq[i]) { matches = false; break; }
          }
          if (matches) {
            const m = new Map<number, number>();
            for (let i = 0; i < n; i++) {
              const pos = altFwd ? (altStart + i) % n : ((altStart - i) % n + n) % n;
              m.set(ring.atoms[pos], i + 1);
            }
            allMatchedMaps.push(m);
          }
        }
      }
    }

    // Pick the best map: minimize heteroatom locants, then PCG locants, then sub locants
    const heteroIdxSet = new Set(ring.heteroatoms);

    let bestMap = allMatchedMaps[0];
    let bestHeteroLocs = getLocants(bestMap, heteroIdxSet);
    let bestPcgLocs = opts.pcgAtoms ? getLocants(bestMap, opts.pcgAtoms) : [];
    let bestSubLocs = opts.subAtoms ? getLocants(bestMap, opts.subAtoms) : [];

    for (let mi = 1; mi < allMatchedMaps.length; mi++) {
      const m = allMatchedMaps[mi];
      const hLocs = getLocants(m, heteroIdxSet);
      const pLocs = opts.pcgAtoms ? getLocants(m, opts.pcgAtoms) : [];
      const sLocs = opts.subAtoms ? getLocants(m, opts.subAtoms) : [];

      let cmp = compareArr(hLocs, bestHeteroLocs);
      if (cmp < 0) { bestMap = m; bestHeteroLocs = hLocs; bestPcgLocs = pLocs; bestSubLocs = sLocs; continue; }
      if (cmp > 0) continue;

      if (opts.pcgAtoms && opts.pcgAtoms.size > 0) {
        cmp = compareArr(pLocs, bestPcgLocs);
        if (cmp < 0) { bestMap = m; bestHeteroLocs = hLocs; bestPcgLocs = pLocs; bestSubLocs = sLocs; continue; }
        if (cmp > 0) continue;
      }

      if (opts.subAtoms && opts.subAtoms.size > 0) {
        cmp = compareArr(sLocs, bestSubLocs);
        if (cmp < 0) { bestMap = m; bestHeteroLocs = hLocs; bestPcgLocs = pLocs; bestSubLocs = sLocs; continue; }
      }
    }

    return { parent: entry.name, locantOf: bestMap, kind: "heterocycle" };
  }

  return null;
}

function getLocants(locantOf: Map<number, number>, atomSet: Set<number>): number[] {
  const locs: number[] = [];
  for (const [idx, loc] of locantOf) {
    if (atomSet.has(idx)) locs.push(loc);
  }
  return locs.sort((a, b) => a - b);
}

/**
 * Build the ring-as-substituent name, e.g. "cyclohexyl", "phenyl", "pyridin-2-yl".
 * attachAtomIdx: the ring atom where the bond to the chain is formed.
 * attachLocant: the IUPAC locant of that atom.
 */
// ────────────────────────────────────────────────────────────────────────────────
// T4 Stage 2: polycyclic fingerprint + curated fused table + isomorphism naming
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Atom label for polycyclic fingerprint: element + (for H-bearing heteroatoms) H count.
 * Aromatic ring atoms are detected by examining the ring-bond network.
 */
function fusedAtomLabel(graph: MolGraph, idx: number): string {
  const a = graph.atoms.find(x => x.index === idx);
  if (!a) return "?";
  // H on heteroatom is significant (e.g. N-H vs pyridine-N vs pyrrole-N)
  if (a.element !== "C" && a.hydrogens > 0) {
    return `${a.element}H${a.hydrogens}`;
  }
  return a.element;
}

/**
 * Bond label between two ring atoms (use order, but normalize aromatic ring bonds).
 * Since all fused systems we care about are aromatic, use "ar" for all ring bonds
 * between aromatic-ring atoms and actual order otherwise.
 */
function fusedBondLabel(graph: MolGraph, a: number, b: number): string {
  for (const bond of graph.bonds) {
    if ((bond.from === a && bond.to === b) || (bond.from === b && bond.to === a)) {
      // Use actual Kekulé order; this is stable for aromatic systems
      return String(bond.order);
    }
  }
  return "1";
}

/**
 * Build a canonical polycyclic fingerprint for the fused ring skeleton.
 *
 * Algorithm:
 * 1. Collect all ring atoms and ring bonds (bonds with both endpoints in ring).
 * 2. Build the local graph with atom labels and bond labels.
 * 3. Use WL (Weisfeiler-Lehman) iteration to get canonical atom signatures.
 * 4. Canonicalize by finding the starting atom that produces the lex-smallest
 *    BFS sequence.
 *
 * Returns a canonical string that is identical for all valid graph isomorphs.
 */
export function polycyclicFingerprint(graph: MolGraph, ringSys: RingSystemInfo): string {
  const atoms = [...ringSys.atoms].sort((a, b) => a - b);
  if (atoms.length === 0) return "";

  const atomLabel = (idx: number): string => fusedAtomLabel(graph, idx);
  const bondLabel = (a: number, b: number): string => fusedBondLabel(graph, a, b);

  // Build adjacency for ring atoms (ring bonds only)
  const adj = new Map<number, number[]>();
  for (const a of atoms) adj.set(a, []);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      adj.get(b.from)!.push(b.to);
      adj.get(b.to)!.push(b.from);
    }
  }

  // Produce canonical BFS string starting from each atom, pick lex-smallest
  // BFS format: atomLabel(bond_order)atomLabel(bond_order)...
  function bfsString(start: number): string {
    const visited = new Set<number>([start]);
    const queue: number[] = [start];
    const parts: string[] = [atomLabel(start)];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      // Sort neighbors by their BFS-canonical label for determinism
      const nbrs = (adj.get(cur) ?? []).filter(n => !visited.has(n));
      // Sort by: bond label, then atom label
      nbrs.sort((a, b) => {
        const bl1 = bondLabel(cur, a), bl2 = bondLabel(cur, b);
        if (bl1 !== bl2) return bl1 < bl2 ? -1 : 1;
        const al1 = atomLabel(a), al2 = atomLabel(b);
        return al1 < al2 ? -1 : al1 > al2 ? 1 : 0;
      });
      for (const nbr of nbrs) {
        visited.add(nbr);
        queue.push(nbr);
        parts.push(`(${bondLabel(cur, nbr)})${atomLabel(nbr)}`);
      }
    }
    return parts.join("|");
  }

  let best = "";
  for (const a of atoms) {
    const s = bfsString(a);
    if (best === "" || s < best) best = s;
  }
  return best;
}

// ── Curated fused ring table ──────────────────────────────────────────────────

export interface FusedRingEntry {
  /** IUPAC retained name (e.g. "naphthalene", "1H-indole") */
  name: string;
  /**
   * Canonical atom order: atoms listed in IUPAC locant order (index i → locant i+1).
   * Each element is an atom descriptor: `{ element, hydrogens }`
   * This describes the table's canonical form; isomorphism maps real atoms onto it.
   */
  canonicalOrder: { element: string; hydrogens: number }[];
  /**
   * Ring bonds in canonical order (for isomorphism matching).
   * Each entry is [locant_a - 1, locant_b - 1] (0-based indices into canonicalOrder).
   */
  canonicalBonds: [number, number][];
  /**
   * Indicated hydrogen locant (1-based), if any. E.g. 1 for "1H-indole", 7 for "7H-purine".
   * null for systems with no indicated H.
   */
  indicatedH: number | null;
}

/**
 * Build the ring graph adjacency for the table entry.
 * Returns adj: Map<index, Set<neighbor index>>.
 */
function tableAdj(entry: FusedRingEntry): Map<number, Set<number>> {
  const n = entry.canonicalOrder.length;
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) adj.set(i, new Set());
  for (const [a, b] of entry.canonicalBonds) {
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  return adj;
}

/**
 * The curated fused ring table.
 *
 * For each entry:
 * - canonicalOrder: atoms in IUPAC locant order (locant = index+1)
 * - canonicalBonds: bonds (pairs of 0-based indices)
 * - indicatedH: locant of N-H (1-based), or null
 *
 * Atom descriptors: { element, hydrogens } where hydrogens = attached H count.
 * For fully aromatic systems all H=0 except N-H positions.
 *
 * IUPAC numbering references: Nomenclature of Fused Polycyclic Hydrocarbons (IUPAC 2013),
 * Hantzsch-Widman names, and PubChem verified names.
 */
function C(hydrogens = 1): { element: string; hydrogens: number } {
  return { element: "C", hydrogens };
}
function N(hydrogens = 0): { element: string; hydrogens: number } {
  return { element: "N", hydrogens };
}
function O(): { element: string; hydrogens: number } {
  return { element: "O", hydrogens: 0 };
}
function S(): { element: string; hydrogens: number } {
  return { element: "S", hydrogens: 0 };
}
const C0 = C(0); // fusion carbon (no H)

export const FUSED_RING_TABLE: FusedRingEntry[] = [
  // ────────────────────────────────────────────────────────────────────────────
  // NAPHTHALENE (C10H8): two fused benzene rings
  // IUPAC numbering: atoms 1-4 in first ring, then 4a,5-8,8a (fusion atoms 4a,8a)
  // For our purposes: atoms numbered 1-10 linearly:
  //   Ring 1: 1-2-3-4-4a-8a  Ring 2: 4a-5-6-7-8-8a
  //   Locants: 1,2,3,4,4a=5,5=6,6=7,7=8,8=9,8a=10 (simplified to 1-10 without a/b)
  // Actually for substituent purposes we use simple 1-8 + 4a,8a.
  // PubChem canonical for 2-methylnaphthalene: position 2 is the second C.
  // For the isomorphism we only need the connectivity, not the "a" notation.
  // Atoms: 1(C),2(C),3(C),4(C),4a(C),5(C),6(C),7(C),8(C),8a(C)
  // Bonds: 1-2,2-3,3-4,4-4a,4a-5,5-6,6-7,7-8,8-8a,8a-1,4a-8a
  // 4a=index 4, 8a=index 9 (0-based: 0-9)
  {
    name: "naphthalene",
    indicatedH: null,
    canonicalOrder: [C(), C(), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0],
      [4,9], // fusion bond (4a–8a)
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // QUINOLINE (C9H7N): benzo[b]pyridine – N at position 1
  // Ring 1 (pyridine): 1(N),2(C),3(C),4(C),4a(C),8a(C)
  // Ring 2 (benzene): 4a,5(C),6(C),7(C),8(C),8a
  // Atoms (0-based): 0=N(1), 1=C(2), 2=C(3), 3=C(4), 4=C(4a), 5=C(5), 6=C(6), 7=C(7), 8=C(8), 9=C(8a)
  {
    name: "quinoline",
    indicatedH: null,
    canonicalOrder: [N(), C(), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0],
      [4,9],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ISOQUINOLINE (C9H7N): N at position 2
  // Ring 1 (pyridine): 1(C),2(N),3(C),4(C),4a(C),8a(C)
  // Ring 2 (benzene): 4a,5,6,7,8,8a
  // Atoms (0-based): 0=C(1), 1=N(2), 2=C(3), 3=C(4), 4=C(4a), 5=C(5), 6=C(6), 7=C(7), 8=C(8), 9=C(8a)
  {
    name: "isoquinoline",
    indicatedH: null,
    canonicalOrder: [C(), N(), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0],
      [4,9],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1-BENZOFURAN: benzo[b]furan – O at position 1 (heteroatom ring = 5-membered)
  // PubChem name: 1-benzofuran
  // IUPAC numbering: O=1, C2=2, C3=3, C3a=4(fused), C4=5, C5=6, C6=7, C7=8, C7a=9(fused)
  // 0-based: 0=O(1),1=C(2),2=C(3),3=C(3a),4=C(4),5=C(5),6=C(6),7=C(7),8=C(7a)
  // Bonds: O-C2(0-1),C2-C3(1-2),C3-C3a(2-3),C3a-C7a(3-8 fusion),C3a-C4(3-4),C4-C5(4-5),C5-C6(5-6),C6-C7(6-7),C7-C7a(7-8),C7a-O(8-0)
  {
    name: "1-benzofuran",
    indicatedH: null,
    canonicalOrder: [O(), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8], // fusion bond C3a-C7a
      [3,4],[4,5],[5,6],[6,7],[7,8],[8,0],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1-BENZOTHIOPHENE: benzo[b]thiophene – S at position 1
  // Same topology as benzofuran but S instead of O
  // PubChem: 1-benzothiophene
  {
    name: "1-benzothiophene",
    indicatedH: null,
    canonicalOrder: [S(), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],
      [3,4],[4,5],[5,6],[6,7],[7,8],[8,0],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1H-INDOLE: benzo[b]pyrrole – N-H at position 1
  // PubChem: 1H-indole
  // IUPAC numbering: N=1, C2=2, C3=3, C3a=4(fused), C4=5, C5=6, C6=7, C7=8, C7a=9(fused)
  // 0-based: 0=NH(1),1=C(2),2=C(3),3=C(3a),4=C(4),5=C(5),6=C(6),7=C(7),8=C(7a)
  {
    name: "1H-indole",
    indicatedH: 1,
    canonicalOrder: [N(1), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],
      [3,4],[4,5],[5,6],[6,7],[7,8],[8,0],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1H-BENZIMIDAZOLE: benzo[d]imidazole – N-H at position 1, N at position 3
  // PubChem: 1H-benzimidazole
  // IUPAC numbering: NH=1, C2=2(between N1 and N3), N=3, C3a=4(fused), C4=5, C5=6, C6=7, C7=8, C7a=9(fused)
  // 0-based: 0=NH(1),1=C(2),2=N(3),3=C(3a),4=C(4),5=C(5),6=C(6),7=C(7),8=C(7a)
  {
    name: "1H-benzimidazole",
    indicatedH: 1,
    canonicalOrder: [N(1), C(), N(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],
      [3,4],[4,5],[5,6],[6,7],[7,8],[8,0],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1H-INDAZOLE: benzo[c]pyrazole – N-H at position 1, N at position 2
  // PubChem: 1H-indazole
  // IUPAC: N-H=1, N=2, C=3, C3a=4(fused), C4=5, C5=6, C6=7, C7=8, C7a=9(fused)
  // 0-based: 0=NH(1),1=N(2),2=C(3),3=C(3a),4=C(4),5=C(5),6=C(6),7=C(7),8=C(7a)
  {
    name: "1H-indazole",
    indicatedH: 1,
    canonicalOrder: [N(1), N(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],
      [3,4],[4,5],[5,6],[6,7],[7,8],[8,0],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // QUINOXALINE: benzo[g]pyrazine – N at 1 and N at 4 in bicyclic numbering
  // PubChem: quinoxaline
  // IUPAC numbering: N=1, C=2, N=3 (wait - actually quinoxaline is 1,4-benzodiazine)
  // Quinoxaline: positions 1,4 are N in the pyrazine ring fused to benzene.
  // IUPAC: atoms 1(N),2(C),3(N),4(C hmm) ...
  // Standard quinoxaline numbering: N1, C2, N3, C4(? no)
  // Actually quinoxaline = benzo[g]pyrazine: N at 1 and 4 (para to each other in 6-membered ring)
  // Wait: quinoxaline CID 9260 - the pyrazine ring is fused.
  // Standard IUPAC: 1-N, 2-C, 3-N, 4-... no
  // Quinoxaline numbering per IUPAC: N1-C2=C3-N4=... no
  // SMILES c1cnc2ccccc2n1: atom order 0=C(1),1=N(2? or 4?),2=C(3),3=C(3a or 4a),4=C,5=C,6=C,7=C,8=C(8a or similar),9=N
  // PubChem canonical SMILES for quinoxaline: C1=CN=C2C=CC=CC2=N1
  // IUPAC locants: N1,C2,N3,C4,C4a,C5,C6,C7,C8,C8a (numbering: N at 1 and 4)
  // Bonds: N1-C2,C2=N3(? no), N1=C8a,C8a-C8,...
  // Standard: 1(N),2(C),3(N),then C4=C(bridge)...
  // Actually IUPAC 2013 says quinoxaline = 1,4-benzodiazine, N at positions 1,4.
  // Ring atoms (0-based): 0=N(1),1=C(2),2=N(3? no, 4 is the second N)...
  // Let me use: 0=N(1),1=C(2),2=C(3),3=N(4),4=C(4a)fusion,5=C(5),6=C(6),7=C(7),8=C(8),9=C(8a)fusion
  {
    name: "quinoxaline",
    indicatedH: null,
    canonicalOrder: [N(), C(), C(), N(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0],
      [4,9],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // QUINAZOLINE: benzo[d]pyrimidine – N at 1 and 3 (1,3-positions)
  // PubChem: quinazoline
  // IUPAC: N1,C2,N3,C4,C4a(fused),C5,C6,C7,C8,C8a(fused)
  // 0-based: 0=N(1),1=C(2),2=N(3),3=C(4),4=C(4a),5=C(5),6=C(6),7=C(7),8=C(8),9=C(8a)
  {
    name: "quinazoline",
    indicatedH: null,
    canonicalOrder: [N(), C(), N(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0],
      [4,9],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // CINNOLINE: benzo[c]pyridazine – N at 1 and 2 (adjacent)
  // PubChem: cinnoline
  // IUPAC: N1,N2,C3,C4,C4a(fused),C5,C6,C7,C8,C8a(fused)
  // 0-based: 0=N(1),1=N(2),2=C(3),3=C(4),4=C(4a),5=C(5),6=C(6),7=C(7),8=C(8),9=C(8a)
  {
    name: "cinnoline",
    indicatedH: null,
    canonicalOrder: [N(), N(), C(), C(), C0, C(), C(), C(), C(), C0],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0],
      [4,9],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 7H-PURINE: imidazo[4,5-d]pyrimidine – N at 1,3,7,9 (bicyclic, 4N)
  // PubChem: 7H-purine (preferred tautomer; 9H-purine also named "7H-purine" by PubChem)
  // IUPAC numbering for 7H-purine:
  //   Ring I (pyrimidine): N1,C2,N3,C4,C5,C6  (6-membered)
  //   Ring II (imidazole): C4,C5,N7(H),C8,N9  (5-membered, shared: C4,C5)
  //   7H means N7 bears H
  // Topology (7H-purine): NH (N7) is adjacent to C8 and C5(fusion).
  //   C5(fusion) connects to C4(fusion), C6, N7. C4(fusion) connects to N3, C5, N9.
  // 0-based indices (IUPAC order): 0=N(1),1=C(2),2=N(3),3=C(4),4=C(5),5=C(6),6=N(7,H),7=C(8),8=N(9)
  // Bonds: pyrimidine: (0,1),(1,2),(2,3),(3,4),(4,5),(5,0)
  //        imidazole:  (3,8),(8,7),(7,6),(6,4)
  {
    name: "7H-purine",
    indicatedH: 7,
    canonicalOrder: [N(), C(), N(), C0, C0, C(), N(1), C(), N()],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,0], // pyrimidine ring
      [3,8],[8,7],[7,6],[6,4],              // imidazole ring (shared: 3=C4, 4=C5)
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 7H-PURINE (9H-tautomer topology): same preferred name per PubChem normalization
  // The SMILES c1nc2[nH]cnc2cn1 draws the 9H tautomer (NH at N9) but PubChem
  // normalizes this to "7H-purine". We accept both tautomer topologies.
  // Topology (9H-purine): NH (N9) is adjacent to C8 and C4(fusion).
  //   C4(fusion) connects to N3, C5(fusion), N9. C5(fusion) connects to C4, C6, N7.
  // 0-based indices (drawn topology from c1nc2[nH]cnc2cn1):
  //   0=C, 1=N, 2=C(fusion), 3=NH, 4=C, 5=N, 6=C(fusion), 7=C, 8=N
  // Bonds: 6-ring: [0,1],[1,2],[2,6],[6,7],[7,8],[8,0]
  //        5-ring: [2,3],[3,4],[4,5],[5,6] (shared: 2,6)
  {
    name: "7H-purine",
    indicatedH: 7,
    canonicalOrder: [C(), N(), C0, N(1), C(), N(), C0, C(), N()],
    canonicalBonds: [
      [0,1],[1,2],[2,6],[6,7],[7,8],[8,0], // pyrimidine ring (6-membered)
      [2,3],[3,4],[4,5],[5,6],              // imidazole ring (5-membered; shared: 2=C4, 6=C5)
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ANTHRACENE (C14H10): three linearly fused benzene rings
  // Linear fusion A-B-C: each adjacent pair shares one bond (2 atoms).
  // 14 atoms, 15 bonds total (3×6 - 2×2 = 14 atoms; 3×6 - 2×1 = 16... actually 3×6-3=15).
  //
  // Topology derived from RDKit output for c1ccc2cc3ccccc3cc2c1:
  //   Fusion atoms (H=0, degree 3): indices 3, 5, 10, 12 (0-based in drawn graph)
  //   Outer perimeter: 0-1-2-3-4-5-6-7-8-9-10-11-12-13-0 (14 atoms)
  //   Fusion bonds: 3-12 (between ring1 and ring2) and 5-10 (between ring2 and ring3)
  //   Ring1: {0,1,2,3,12,13}  Ring2: {3,4,5,10,11,12}  Ring3: {5,6,7,8,9,10}
  //
  // IUPAC locant assignment: 1=C,2=C,3=C,4=C,4a=C(fus),5=C,6=C,7=C,8=C,9=C,10=C,10a=C(fus),9a=C(fus),4b=C(fus)
  // In table indices: 0-based positions are used; locant = index+1 (with 4a=index 3, 9a=index 5, etc.)
  {
    name: "anthracene",
    indicatedH: null,
    canonicalOrder: [
      C(), C(), C(), C0, C(), C0, C(), C(), C(), C(), C0, C(), C0, C(),
    ],
    // Perimeter bonds + 2 fusion bonds matching RDKit c1ccc2cc3ccccc3cc2c1 topology:
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,0],
      [3,12],[5,10], // fusion bonds
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // PHENANTHRENE (C14H10): three fused benzene rings in angular arrangement
  // Angular fusion distinguishes it from anthracene (linear).
  //
  // Topology derived from RDKit output for c1ccc2ccc3ccccc3c2c1:
  //   Fusion atoms (H=0, degree 3): indices 3, 6, 11, 12 (0-based in drawn graph)
  //   Outer perimeter: 0-1-2-3-4-5-6-7-8-9-10-11-12-13-0 (14 atoms)
  //   Fusion bonds: 3-12 (between ring1 and ring2) and 6-11 (between ring2 and ring3)
  //   Ring1: {0,1,2,3,12,13}  Ring2: {3,4,5,6,11,12}  Ring3: {6,7,8,9,10,11}
  //
  // The angular topology means fusion bonds 3-12 and 6-11 are separated by 3 perimeter
  // steps (3→4→5→6), vs anthracene's 2 steps (3→4→5). This is the key graph difference.
  {
    name: "phenanthrene",
    indicatedH: null,
    canonicalOrder: [
      C(), C(), C(), C0, C(), C(), C0, C(), C(), C(), C(), C0, C0, C(),
    ],
    // Perimeter bonds + 2 fusion bonds matching RDKit c1ccc2ccc3ccccc3c2c1 topology:
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,0],
      [3,12],[6,11], // fusion bonds (angular)
    ],
  },
];

// ── Graph isomorphism for fused ring systems ──────────────────────────────────

/**
 * Find all graph isomorphisms between the drawn ring system and the table entry.
 * Returns a list of maps: drawn atom index → table locant (1-based).
 *
 * Uses VF2-style backtracking for small graphs (≤14 atoms).
 *
 * @param graph - the full molecular graph
 * @param ringSys - the perceived ring system
 * @param entry - the table entry to match against
 */
function findIsomorphisms(
  graph: MolGraph,
  ringSys: RingSystemInfo,
  entry: FusedRingEntry,
): Map<number, number>[] {
  const drawnAtoms = [...ringSys.atoms].sort((a, b) => a - b);
  const tableAtoms = entry.canonicalOrder;
  const n = tableAtoms.length;

  if (drawnAtoms.length !== n) return [];

  // Build drawn adjacency (ring bonds only)
  const drawnAdj = new Map<number, Set<number>>();
  for (const a of drawnAtoms) drawnAdj.set(a, new Set());
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      drawnAdj.get(b.from)!.add(b.to);
      drawnAdj.get(b.to)!.add(b.from);
    }
  }

  // Build table adjacency (0-based), returns Map<index, Set<neighbor>>
  const tableAdjMap: Map<number, Set<number>> = tableAdj(entry);

  // Get drawn atom label (element + H count)
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));
  const drawnLabel = (idx: number): string => {
    const a = atomById.get(idx);
    if (!a) return "?";
    if (a.element !== "C" && a.hydrogens > 0) return `${a.element}H${a.hydrogens}`;
    return a.element;
  };

  // Get table atom label
  const tableLabel = (i: number): string => {
    const t = tableAtoms[i];
    if (t.element !== "C" && t.hydrogens > 0) return `${t.element}H${t.hydrogens}`;
    return t.element;
  };

  // Check degree compatibility
  const drawnDegree = (idx: number): number => drawnAdj.get(idx)?.size ?? 0;
  const tableDegree = (i: number): number => tableAdjMap.get(i)?.size ?? 0;

  // VF2-style backtracking
  const mapping: Map<number, number> = new Map(); // drawnAtom → tableIndex (0-based)
  const usedTable = new Set<number>();
  const results: Map<number, number>[] = [];

  function isCompatible(drawnIdx: number, tableIdx: number): boolean {
    if (drawnLabel(drawnIdx) !== tableLabel(tableIdx)) return false;
    if (drawnDegree(drawnIdx) !== tableDegree(tableIdx)) return false;
    // Check consistency with existing partial mapping
    for (const [da, ta] of mapping) {
      const drawnConnected = drawnAdj.get(drawnIdx)?.has(da) ?? false;
      const tableConnected = tableAdjMap.get(tableIdx)?.has(ta) ?? false;
      if (drawnConnected !== tableConnected) return false;
    }
    return true;
  }

  function backtrack(step: number): void {
    if (step === n) {
      // Complete mapping found: convert to locant map (locant = tableIdx + 1)
      const locantMap = new Map<number, number>();
      for (const [da, ti] of mapping) {
        locantMap.set(da, ti + 1);
      }
      results.push(locantMap);
      return;
    }

    // Pick next drawn atom to map (in order of drawnAtoms array)
    const nextDrawn = drawnAtoms[step];

    // Try all unused table positions
    for (let ti = 0; ti < n; ti++) {
      if (usedTable.has(ti)) continue;
      if (!isCompatible(nextDrawn, ti)) continue;

      mapping.set(nextDrawn, ti);
      usedTable.add(ti);
      backtrack(step + 1);
      mapping.delete(nextDrawn);
      usedTable.delete(ti);
    }
  }

  backtrack(0);
  return results;
}

/**
 * Compare two locant arrays (ascending) for the isomorphism selection criterion.
 * Lower first-difference wins (IUPAC lowest locant rule).
 */
function compareLocantSets(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Result of fused ring name lookup.
 */
export interface FusedRingNaming {
  parent: string;
  /** Map: drawn atom index → IUPAC locant (1-based) */
  locantOf: Map<number, number>;
  /** Whether the name has an indicated hydrogen prefix (e.g. "1H-") */
  indicatedH: number | null;
  kind: "fused";
}

/**
 * Look up the fused ring system in the curated table, perform isomorphism
 * to assign locants, and return the naming or null if not matched.
 *
 * Selection among multiple isomorphisms:
 * 1. Lowest locant set for PCG atoms (if any)
 * 2. Lowest locant set for substituent atoms
 * 3. Arbitrary (first found)
 */
export function nameFusedRing(
  graph: MolGraph,
  ringSys: RingSystemInfo,
  opts: {
    pcgAtoms?: Set<number>;
    subAtoms?: Set<number>;
  } = {},
): FusedRingNaming | null {
  const n = ringSys.atoms.size;

  // Find matching table entries by atom count
  const candidates = FUSED_RING_TABLE.filter(e => e.canonicalOrder.length === n);
  if (candidates.length === 0) return null;

  for (const entry of candidates) {
    const isos = findIsomorphisms(graph, ringSys, entry);
    if (isos.length === 0) continue;

    // Among valid isomorphisms, pick the one with lowest locants for PCG, then subs
    let best = isos[0];

    if (opts.pcgAtoms && opts.pcgAtoms.size > 0) {
      let bestPcgLocs = [...opts.pcgAtoms]
        .map(a => best.get(a) ?? 99)
        .sort((x, y) => x - y);

      for (const iso of isos.slice(1)) {
        const pcgLocs = [...opts.pcgAtoms]
          .map(a => iso.get(a) ?? 99)
          .sort((x, y) => x - y);
        if (compareLocantSets(pcgLocs, bestPcgLocs) < 0) {
          best = iso;
          bestPcgLocs = pcgLocs;
        }
      }
    } else if (opts.subAtoms && opts.subAtoms.size > 0) {
      let bestSubLocs = [...opts.subAtoms]
        .map(a => best.get(a) ?? 99)
        .sort((x, y) => x - y);

      for (const iso of isos.slice(1)) {
        const subLocs = [...opts.subAtoms]
          .map(a => iso.get(a) ?? 99)
          .sort((x, y) => x - y);
        if (compareLocantSets(subLocs, bestSubLocs) < 0) {
          best = iso;
          bestSubLocs = subLocs;
        }
      }
    }

    return {
      parent: entry.name,
      locantOf: best,
      indicatedH: entry.indicatedH,
      kind: "fused",
    };
  }

  return null;
}

export function ringSubstituentName(
  parentName: string,
  kind: "carbocycle" | "benzene" | "heterocycle",
  attachLocant: number,
): string {
  // benzene → phenyl (special)
  if (kind === "benzene") return "phenyl";

  // Carbocycles: cyclohexane → cyclohexyl (drop "-ane", add "-yl")
  //   The "-ane" suffix removal (not just trailing 'e') gives the correct stem:
  //   cyclohexane → cyclohex + yl = cyclohexyl (not cyclohexanyl).
  // Heterocycles: drop trailing 'e' only → pyridine → pyridin-2-yl.
  if (kind === "carbocycle") {
    const base = parentName.endsWith("ane") ? parentName.slice(0, -3) : parentName;
    if (attachLocant === 1) return `${base}yl`;
    return `${base}-${attachLocant}-yl`;
  }

  // Heterocycles: drop trailing 'e' → add '-locant-yl'
  const base = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
  if (attachLocant === 1) return `${base}yl`;
  return `${base}-${attachLocant}-yl`;
}
